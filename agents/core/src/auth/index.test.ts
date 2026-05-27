import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./index.js";

test("hashPassword returns scrypt:salt:hash", async () => {
  const hash = await hashPassword("hunter2");
  const parts = hash.split(":");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "scrypt");
  // base64 salt + hash
  assert.ok(parts[1].length > 0);
  assert.ok(parts[2].length > 0);
});

test("verifyPassword roundtrips the right password", async () => {
  const hash = await hashPassword("hunter2");
  assert.equal(await verifyPassword("hunter2", hash), true);
});

test("verifyPassword rejects the wrong password", async () => {
  const hash = await hashPassword("hunter2");
  assert.equal(await verifyPassword("hunter3", hash), false);
});

test("verifyPassword rejects a malformed hash", async () => {
  assert.equal(await verifyPassword("anything", "not-a-real-hash"), false);
  // Right shape, garbage payload — scrypt output won't match random bytes.
  assert.equal(await verifyPassword("anything", "scrypt:only:two"), false);
});

test("verifyPassword is non-deterministic across hashes", async () => {
  const a = await hashPassword("same");
  const b = await hashPassword("same");
  assert.notEqual(a, b, "salts must differ");
  assert.equal(await verifyPassword("same", a), true);
  assert.equal(await verifyPassword("same", b), true);
});
