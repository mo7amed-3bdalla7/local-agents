import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

let workdir: string;

before(() => {
  workdir = mkdtempSync(join(tmpdir(), "agents-secrets-"));
  process.env.AGENTS_DATA_DIR = workdir;
  process.env.AGENTS_SECRETS_KEY = randomBytes(32).toString("base64");
});

after(() => {
  rmSync(workdir, { recursive: true, force: true });
});

test("file adapter round-trips a value", async () => {
  const { fileAdapter } = await import("./file.js");
  const ref = await fileAdapter.set("jira-token:demo", "hunter2");
  assert.match(ref, /^file:[0-9a-f-]{36}$/);
  assert.equal(await fileAdapter.get(ref), "hunter2");
});

test("missing ref returns null", async () => {
  const { fileAdapter } = await import("./file.js");
  const v = await fileAdapter.get("file:00000000-0000-0000-0000-000000000000");
  assert.equal(v, null);
});

test("delete removes the entry", async () => {
  const { fileAdapter } = await import("./file.js");
  const ref = await fileAdapter.set("doomed", "value");
  assert.equal(await fileAdapter.get(ref), "value");
  await fileAdapter.delete(ref);
  assert.equal(await fileAdapter.get(ref), null);
});

test("two stores produce different refs", async () => {
  const { fileAdapter } = await import("./file.js");
  const a = await fileAdapter.set("k", "v");
  const b = await fileAdapter.set("k", "v");
  assert.notEqual(a, b, "each write gets a fresh uuid");
  assert.equal(await fileAdapter.get(a), "v");
  assert.equal(await fileAdapter.get(b), "v");
});
