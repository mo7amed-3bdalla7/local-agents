import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  verifyApiToken,
} from "./tokens.js";
import { closeDb, getDb } from "../db/client.js";
import { schema } from "../db/client.js";
import { eq } from "drizzle-orm";

const DB_URL = process.env.DATABASE_URL;
const SKIP_REASON = "DATABASE_URL not set — skipping integration test";

async function findOrSkip(): Promise<{ userId: string } | null> {
  if (!DB_URL) return null;
  try {
    const db = getDb();
    const [user] = await db.select().from(schema.users).limit(1);
    if (!user) return null;
    return { userId: user.id };
  } catch {
    return null;
  }
}

test("createApiToken produces an agt_ prefixed plaintext + sha256 hash", async (t) => {
  const ctx = await findOrSkip();
  if (!ctx) return t.skip(SKIP_REASON);

  const r = await createApiToken({ ownerId: ctx.userId, name: "test-token" });
  try {
    assert.match(r.token, /^agt_[0-9a-f]{24}$/);
    assert.equal(r.row.prefix.length, 8);
    assert.equal(r.row.tokenHash.length, 64); // sha256 hex
    assert.equal(
      r.row.tokenHash,
      createHash("sha256").update(r.token).digest("hex"),
    );
  } finally {
    await getDb()
      .delete(schema.apiTokens)
      .where(eq(schema.apiTokens.id, r.row.id));
  }
});

test("verifyApiToken accepts active tokens and rejects revoked/expired", async (t) => {
  const ctx = await findOrSkip();
  if (!ctx) return t.skip(SKIP_REASON);

  const r = await createApiToken({ ownerId: ctx.userId, name: "active" });
  const expired = await createApiToken({
    ownerId: ctx.userId,
    name: "expired",
    expiresAt: new Date(Date.now() - 1000),
  });
  try {
    const u = await verifyApiToken(r.token);
    assert.ok(u, "active token verifies");
    assert.equal(u?.id, ctx.userId);

    assert.equal(await verifyApiToken(expired.token), undefined);
    assert.equal(await verifyApiToken("agt_deadbeef00000000000000ff"), undefined);
    assert.equal(await verifyApiToken("not-a-token"), undefined);

    const revoked = await revokeApiToken(r.row.id, ctx.userId);
    assert.equal(revoked, true);
    assert.equal(await verifyApiToken(r.token), undefined);
  } finally {
    await getDb()
      .delete(schema.apiTokens)
      .where(eq(schema.apiTokens.ownerId, ctx.userId));
  }
});

test("listApiTokens scopes to owner", async (t) => {
  const ctx = await findOrSkip();
  if (!ctx) return t.skip(SKIP_REASON);

  const r = await createApiToken({ ownerId: ctx.userId, name: "scope-test" });
  try {
    const rows = await listApiTokens(ctx.userId);
    assert.ok(
      rows.some((x) => x.id === r.row.id),
      "list returns user's token",
    );
  } finally {
    await getDb()
      .delete(schema.apiTokens)
      .where(eq(schema.apiTokens.id, r.row.id));
  }
});

test.after(async () => {
  await closeDb().catch(() => undefined);
});
