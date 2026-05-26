/**
 * API tokens — Bearer auth for programmatic access.
 *
 * Format: `agt_<24-char hex>` (12 bytes of randomness ⇒ ~96 bits, fine).
 * Stored in DB as sha256 hex of the full token; plaintext is shown once
 * at creation and never again. The first 8 hex chars after the prefix
 * are also stored unhashed (`prefix` column) so the UI can identify
 * each token without exposing the secret.
 *
 * Revocation is a soft-delete (`revoked_at`) so audit trails survive.
 * Listing filters revoked + expired rows out by default.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";
import { getUserById } from "./index.js";
import type { User } from "./index.js";

const TOKEN_PREFIX = "agt_";
const TOKEN_BYTES = 12; // 24 hex chars

export type ApiToken = typeof schema.apiTokens.$inferSelect;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateTokenArgs {
  ownerId: string;
  name: string;
  /** Optional expiry. Null = never expires (revoke manually). */
  expiresAt?: Date | null;
}

export interface CreateTokenResult {
  /** Plaintext token. Returned ONCE; the user must copy it now. */
  token: string;
  row: ApiToken;
}

export async function createApiToken(
  args: CreateTokenArgs,
): Promise<CreateTokenResult> {
  const name = args.name.trim();
  if (!name) throw new Error("Token name is required");

  const random = randomBytes(TOKEN_BYTES).toString("hex");
  const token = `${TOKEN_PREFIX}${random}`;
  const prefix = random.slice(0, 8);
  const tokenHash = hashToken(token);

  const [row] = await getDb()
    .insert(schema.apiTokens)
    .values({
      ownerId: args.ownerId,
      name,
      tokenHash,
      prefix,
      expiresAt: args.expiresAt ?? null,
    })
    .returning();

  return { token, row };
}

export async function listApiTokens(ownerId: string): Promise<ApiToken[]> {
  // Surface every token the user has ever created, regardless of state — the
  // UI can show "Revoked"/"Expired" tags so users keep a clear history.
  return getDb()
    .select()
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.ownerId, ownerId))
    .orderBy(desc(schema.apiTokens.createdAt));
}

export async function revokeApiToken(
  id: string,
  ownerId: string,
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(schema.apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiTokens.id, id),
        eq(schema.apiTokens.ownerId, ownerId),
        isNull(schema.apiTokens.revokedAt),
      ),
    )
    .returning({ id: schema.apiTokens.id });
  return updated.length > 0;
}

/**
 * Verify a token string and return the owning user, or undefined if the
 * token is unknown, revoked, or expired. Touches `last_used_at` on success
 * (fire-and-forget; errors swallowed).
 */
export async function verifyApiToken(
  token: string,
): Promise<User | undefined> {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) {
    return undefined;
  }
  const hash = hashToken(token);
  const db = getDb();
  const now = new Date();

  const [row] = await db
    .select()
    .from(schema.apiTokens)
    .where(
      and(
        eq(schema.apiTokens.tokenHash, hash),
        isNull(schema.apiTokens.revokedAt),
        or(
          isNull(schema.apiTokens.expiresAt),
          gt(schema.apiTokens.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (!row) return undefined;

  // Best-effort timestamp update. A token used hundreds of times per minute
  // would batch this in a real system; here we just write each hit.
  void db
    .update(schema.apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(schema.apiTokens.id, row.id))
    .catch(() => undefined);

  return getUserById(row.ownerId);
}
