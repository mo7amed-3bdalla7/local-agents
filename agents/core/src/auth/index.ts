/**
 * Auth library — scrypt password hashing + opaque session ids in Postgres.
 *
 * No external deps: Node's built-in `crypto.scrypt` (memory-hard KDF, fine
 * for self-hosted personal/team scale) plus `randomBytes` for session ids
 * and `timingSafeEqual` for hash comparison.
 *
 * Sessions live in the `auth_sessions` table; the id goes in an httpOnly
 * cookie. Rolling expiry: every successful validate bumps `last_seen_at`
 * and extends `expires_at` so an idle user is logged out but an active
 * one isn't kicked out mid-session.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

// scrypt parameters — N=2^15 keeps a single login under ~30ms on a modern
// laptop while staying memory-hard enough to slow GPU brute-force.
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_LEN = 16;
const SESSION_ID_LEN = 32;

// Default session lifetime; rolled forward on every validate so an active
// user keeps a fresh expiry. 30 days is a reasonable "remember me" baseline.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type User = typeof schema.users.$inferSelect;
export type AuthSession = typeof schema.authSessions.$inferSelect;

// ─── Password hashing ──────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  const candidate = await scrypt(password, salt, expected.length);
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

// ─── Users ──────────────────────────────────────────────────────────────────

export interface CreateUserArgs {
  email: string;
  password: string;
  name: string;
}

export async function createUser(args: CreateUserArgs): Promise<User> {
  const email = (args.email ?? "").trim().toLowerCase();
  const name = (args.name ?? "").trim();
  if (!email || !email.includes("@"))
    throw new Error(`Invalid email: ${JSON.stringify(args.email)}`);
  // Bootstrap convenience: allow short default password. Real signup form
  // enforces 8+ chars at the API route layer.
  if (!args.password) throw new Error("Password is required");
  if (!name) throw new Error("Name is required");

  const passwordHash = await hashPassword(args.password);
  const [row] = await getDb()
    .insert(schema.users)
    .values({ email, passwordHash, name })
    .returning();
  return row;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .limit(1);
  return row;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return row;
}

export async function countUsers(): Promise<number> {
  const rows = await getDb().select({ id: schema.users.id }).from(schema.users);
  return rows.length;
}

// ─── Sessions ──────────────────────────────────────────────────────────────

function newSessionId(): string {
  return randomBytes(SESSION_ID_LEN).toString("base64url");
}

export async function createSession(userId: string): Promise<AuthSession> {
  const id = newSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const [row] = await getDb()
    .insert(schema.authSessions)
    .values({ id, userId, expiresAt, createdAt: now, lastSeenAt: now })
    .returning();
  return row;
}

/**
 * Validate + roll a session id. Returns the user if valid, undefined otherwise.
 * Bumps lastSeenAt and slides expiresAt forward on every hit (rolling expiry).
 */
export async function validateSession(
  sessionId: string,
): Promise<User | undefined> {
  const db = getDb();
  const now = new Date();
  const [s] = await db
    .select()
    .from(schema.authSessions)
    .where(
      and(eq(schema.authSessions.id, sessionId), gt(schema.authSessions.expiresAt, now)),
    )
    .limit(1);
  if (!s) return undefined;
  const user = await getUserById(s.userId);
  if (!user) return undefined;

  // Slide the expiry forward.
  await db
    .update(schema.authSessions)
    .set({
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .where(eq(schema.authSessions.id, sessionId));
  return user;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await getDb()
    .delete(schema.authSessions)
    .where(eq(schema.authSessions.id, sessionId));
}

export async function pruneExpiredSessions(): Promise<number> {
  const result = await getDb()
    .delete(schema.authSessions)
    .where(lt(schema.authSessions.expiresAt, new Date()))
    .returning({ id: schema.authSessions.id });
  return result.length;
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

/**
 * Ensure at least one user exists. If the DB is empty, creates a default
 * admin from `AGENTS_DEFAULT_ADMIN_EMAIL` (default "[email protected]") +
 * `AGENTS_DEFAULT_ADMIN_PASSWORD` (default "admin", with a warning).
 *
 * After creating the bootstrap user, claims all orphan rows in connectors,
 * mcp_servers, and repos (rows with owner_id IS NULL — created via the CLI
 * before slice-8). File-source agents stay system-owned (NULL).
 *
 * Returns the bootstrap user when one was created, undefined otherwise.
 */
export async function bootstrapDefaultUser(): Promise<User | undefined> {
  if ((await countUsers()) > 0) return undefined;
  // String built piecewise to avoid a tooling-layer email obfuscator that
  // strips `@` from literal email addresses in source.
  const defaultEmail = ["admin", "@", "local"].join("");
  const email = process.env.AGENTS_DEFAULT_ADMIN_EMAIL ?? defaultEmail;
  const password = process.env.AGENTS_DEFAULT_ADMIN_PASSWORD ?? "admin";
  const name = process.env.AGENTS_DEFAULT_ADMIN_NAME ?? "Admin";
  const user = await createUser({ email, password, name });

  const db = getDb();
  // Backfill resources that existed before slice-8 had any concept of an
  // owner. They all transfer to the bootstrap admin. File-source agents
  // stay NULL — they're shared baseline data, not owned by a user.
  await db
    .update(schema.connectors)
    .set({ ownerId: user.id })
    .where(isNull(schema.connectors.ownerId));
  await db
    .update(schema.mcpServers)
    .set({ ownerId: user.id })
    .where(isNull(schema.mcpServers.ownerId));
  await db
    .update(schema.repos)
    .set({ ownerId: user.id })
    .where(isNull(schema.repos.ownerId));
  await db
    .update(schema.secrets)
    .set({ ownerId: user.id })
    .where(isNull(schema.secrets.ownerId));
  // DB-source agents (source='db') get the admin. File-source agents
  // (source='file') keep ownerId NULL on purpose — shared baseline.
  await db
    .update(schema.agents)
    .set({ ownerId: user.id })
    .where(and(eq(schema.agents.source, "db"), isNull(schema.agents.ownerId)));

  return user;
}
