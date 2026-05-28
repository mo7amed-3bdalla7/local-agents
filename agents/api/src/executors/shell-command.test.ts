import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShellCommandPayload } from "./shell-command.js";
import type { PendingAction } from "@agents/core";

function action(payload: Record<string, unknown>): PendingAction {
  return { payload } as unknown as PendingAction;
}

test("accepts a minimal payload", () => {
  const p = parseShellCommandPayload(action({ cmd: "ls -la" }));
  assert.equal(p.cmd, "ls -la");
  assert.equal(p.cwd, undefined);
  assert.equal(p.timeoutMs, undefined);
});

test("trims cmd whitespace", () => {
  const p = parseShellCommandPayload(action({ cmd: "  pnpm test  " }));
  assert.equal(p.cmd, "pnpm test");
});

test("rejects empty cmd", () => {
  assert.throws(
    () => parseShellCommandPayload(action({ cmd: "" })),
    /non-empty/,
  );
  assert.throws(
    () => parseShellCommandPayload(action({ cmd: "   " })),
    /non-empty/,
  );
  assert.throws(
    () => parseShellCommandPayload(action({})),
    /non-empty/,
  );
});

test("clamps timeoutMs to [1000, 30min]", () => {
  assert.equal(
    parseShellCommandPayload(action({ cmd: "x", timeoutMs: 100 })).timeoutMs,
    1000,
    "below 1s clamped up",
  );
  assert.equal(
    parseShellCommandPayload(action({ cmd: "x", timeoutMs: 999_999_999 })).timeoutMs,
    30 * 60 * 1000,
    "above 30min clamped down",
  );
  assert.equal(
    parseShellCommandPayload(action({ cmd: "x", timeoutMs: 60_000 })).timeoutMs,
    60_000,
    "inside range passes through",
  );
});

test("ignores non-numeric timeoutMs", () => {
  const p = parseShellCommandPayload(
    action({ cmd: "x", timeoutMs: "ten seconds" }),
  );
  assert.equal(p.timeoutMs, undefined);
});

test("preserves a string cwd", () => {
  const p = parseShellCommandPayload(action({ cmd: "x", cwd: "repo-a/src" }));
  assert.equal(p.cwd, "repo-a/src");
});
