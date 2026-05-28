import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrCreatePayload } from "./pr-create.js";
import type { PendingAction } from "@agents/core";

function action(payload: Record<string, unknown>): PendingAction {
  return { payload } as unknown as PendingAction;
}

test("accepts a well-formed payload", () => {
  const p = parsePrCreatePayload(
    action({
      repo: "anthropics/sdk",
      head: "fix/x",
      base: "main",
      title: "Fix X",
      body: "Closes JIRA-123.",
      draft: true,
    }),
  );
  assert.equal(p.repo, "anthropics/sdk");
  assert.equal(p.head, "fix/x");
  assert.equal(p.base, "main");
  assert.equal(p.title, "Fix X");
  assert.equal(p.body, "Closes JIRA-123.");
  assert.equal(p.draft, true);
});

test("trims head/title and defaults draft to false", () => {
  const p = parsePrCreatePayload(
    action({
      repo: "a/b",
      head: "  fix/x  ",
      title: "  T  ",
      body: "body",
    }),
  );
  assert.equal(p.head, "fix/x");
  assert.equal(p.title, "T");
  assert.equal(p.base, undefined);
  assert.equal(p.draft, false);
});

test("rejects bad repo", () => {
  assert.throws(
    () =>
      parsePrCreatePayload(
        action({ repo: "nope", head: "x", title: "y", body: "z" }),
      ),
    /owner\/name/,
  );
});

test("rejects empty head", () => {
  assert.throws(
    () =>
      parsePrCreatePayload(
        action({ repo: "a/b", head: "  ", title: "y", body: "z" }),
      ),
    /head .* required/,
  );
});

test("rejects missing title and body", () => {
  assert.throws(
    () =>
      parsePrCreatePayload(
        action({ repo: "a/b", head: "x", title: "", body: "z" }),
      ),
    /title .* required/,
  );
  assert.throws(
    () =>
      parsePrCreatePayload(
        action({ repo: "a/b", head: "x", title: "y", body: "   " }),
      ),
    /body .* required/,
  );
});
