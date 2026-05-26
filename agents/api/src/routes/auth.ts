/**
 * Auth routes — POST /api/auth/signup, /login, /logout, GET /me.
 *
 * Cookie: name = `agents_session`, httpOnly, SameSite=Lax, Secure in prod.
 * Value is the opaque session id from auth_sessions. The auth middleware in
 * server.ts is what reads the cookie and gates the rest of /api/*.
 *
 * Signup: open while no users exist (so the very first request can bootstrap
 * past the default admin) and closed thereafter. Adding more users post-
 * bootstrap is a manual admin flow for now.
 */

import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import {
  countUsers,
  createSession,
  createUser,
  deleteSession,
  getUserByEmail,
  validateSession,
  verifyPassword,
} from "@agents/core";

export const COOKIE_NAME = "agents_session";

export const authRouter = new Hono();

function cookieOptions(): Parameters<typeof setCookie>[3] {
  return {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // 30 days, matches the rolling session TTL.
    maxAge: 30 * 24 * 60 * 60,
  };
}

authRouter.post("/signup", async (c) => {
  // Slice-8 policy: signup is open only when no users exist. After that, an
  // admin invites via API directly or `pnpm user create`-style tooling.
  if ((await countUsers()) > 0) {
    return c.json({ error: "signup_closed" }, 403);
  }
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name : "";
  if (password.length < 8) {
    return c.json({ error: "weak_password", message: "min 8 chars" }, 400);
  }
  try {
    const user = await createUser({ email, password, name });
    const session = await createSession(user.id);
    setCookie(c, COOKIE_NAME, session.id, cookieOptions());
    return c.json({ user: { id: user.id, email: user.email, name: user.name } }, 201);
  } catch (err) {
    return c.json(
      { error: "signup_failed", message: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

authRouter.post("/login", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  const user = await getUserByEmail(email);
  // Same response for unknown email and bad password — avoids leaking which
  // emails are registered.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const session = await createSession(user.id);
  setCookie(c, COOKIE_NAME, session.id, cookieOptions());
  return c.json({ user: { id: user.id, email: user.email, name: user.name } });
});

authRouter.post("/logout", async (c) => {
  const sid = getCookie(c, COOKIE_NAME);
  if (sid) await deleteSession(sid);
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.body(null, 204);
});

authRouter.get("/me", async (c) => {
  const sid = getCookie(c, COOKIE_NAME);
  if (!sid) return c.json({ error: "not_authenticated" }, 401);
  const user = await validateSession(sid);
  if (!user) {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ error: "not_authenticated" }, 401);
  }
  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    signupOpen: (await countUsers()) === 0,
  });
});

/**
 * Read-only helper: is signup currently open? Used by the UI to decide
 * whether to render the signup form alongside login. Available without auth.
 */
authRouter.get("/signup-open", async (c) => {
  return c.json({ open: (await countUsers()) === 0 });
});
