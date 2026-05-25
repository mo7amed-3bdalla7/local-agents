/**
 * keytar adapter tests.
 *
 * Pure unit tests for ref parsing/building run unconditionally. The round-trip
 * test hits the real OS keychain — skipped automatically when
 * AGENTS_SKIP_KEYCHAIN_TESTS=1 (CI environments without a keychain).
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import {
  buildKeytarRef,
  keytarAdapter,
  parseKeytarRef,
} from "./keytar.js";
import { MalformedKeychainRefError } from "./types.js";

const SERVICE = "agents-platform-test";

describe("keytar ref parsing", () => {
  it("round-trips a simple account", () => {
    const ref = buildKeytarRef("alpha", SERVICE);
    assert.equal(ref, `keytar:${SERVICE}:alpha`);
    assert.deepEqual(parseKeytarRef(ref), {
      service: SERVICE,
      account: "alpha",
    });
  });

  it("preserves colons in the account portion", () => {
    const ref = buildKeytarRef("github-pat:owner/repo", SERVICE);
    assert.deepEqual(parseKeytarRef(ref), {
      service: SERVICE,
      account: "github-pat:owner/repo",
    });
  });

  it("rejects refs missing the prefix", () => {
    assert.throws(() => parseKeytarRef("not-keytar:svc:acct"), MalformedKeychainRefError);
  });

  it("rejects refs missing the account portion", () => {
    assert.throws(() => parseKeytarRef("keytar:svc-only"), MalformedKeychainRefError);
    assert.throws(() => parseKeytarRef("keytar:svc:"), MalformedKeychainRefError);
    assert.throws(() => parseKeytarRef("keytar::acct"), MalformedKeychainRefError);
  });
});

const SKIP_KEYCHAIN = process.env.AGENTS_SKIP_KEYCHAIN_TESTS === "1";

describe("keytar round-trip (hits OS keychain)", { skip: SKIP_KEYCHAIN }, () => {
  const TEST_PREFIX = `agents-keytar-test-${process.pid}-${Date.now()}`;
  const createdAccounts: string[] = [];

  after(async () => {
    const refs = await keytarAdapter.list?.().catch(() => []);
    for (const account of refs ?? []) {
      if (account.startsWith(TEST_PREFIX)) {
        await keytarAdapter
          .delete(buildKeytarRef(account))
          .catch(() => undefined);
      }
    }
    // Also catch anything we explicitly tracked, in case list() is unavailable
    for (const account of createdAccounts) {
      await keytarAdapter
        .delete(buildKeytarRef(account))
        .catch(() => undefined);
    }
  });

  it("set → get returns the same value", async () => {
    const key = `${TEST_PREFIX}-roundtrip`;
    createdAccounts.push(key);
    const ref = await keytarAdapter.set(key, "shhh-it-is-a-secret");
    assert.match(ref, /^keytar:/);
    const got = await keytarAdapter.get(ref);
    assert.equal(got, "shhh-it-is-a-secret");
  });

  it("get returns null for a missing ref", async () => {
    const ref = buildKeytarRef(`${TEST_PREFIX}-does-not-exist`);
    const got = await keytarAdapter.get(ref);
    assert.equal(got, null);
  });

  it("delete removes the entry", async () => {
    const key = `${TEST_PREFIX}-delete`;
    createdAccounts.push(key);
    const ref = await keytarAdapter.set(key, "temp");
    await keytarAdapter.delete(ref);
    const got = await keytarAdapter.get(ref);
    assert.equal(got, null);
  });

  it("delete on missing ref is a no-op", async () => {
    const ref = buildKeytarRef(`${TEST_PREFIX}-already-gone`);
    await keytarAdapter.delete(ref); // must not throw
  });
});
