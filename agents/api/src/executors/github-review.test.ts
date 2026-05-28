import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGithubReviewPayload } from "./github-review.js";
import type { PendingAction } from "@agents/core";

function action(payload: Record<string, unknown>): PendingAction {
  // The parser only reads action.payload — the other fields are noise.
  return { payload } as unknown as PendingAction;
}

test("accepts a well-formed payload", () => {
  const p = parseGithubReviewPayload(
    action({
      repo: "anthropics/sdk",
      prNumber: 42,
      event: "approve",
      body: "LGTM",
    }),
  );
  assert.equal(p.repo, "anthropics/sdk");
  assert.equal(p.prNumber, 42);
  assert.equal(p.event, "approve");
  assert.equal(p.body, "LGTM");
});

test("rejects non-owner/name repo", () => {
  assert.throws(
    () =>
      parseGithubReviewPayload(
        action({ repo: "nope", prNumber: 1, event: "comment", body: "x" }),
      ),
    /owner\/name/,
  );
});

test("rejects non-positive prNumber", () => {
  assert.throws(
    () =>
      parseGithubReviewPayload(
        action({ repo: "a/b", prNumber: 0, event: "comment", body: "x" }),
      ),
    /positive integer/,
  );
  assert.throws(
    () =>
      parseGithubReviewPayload(
        action({ repo: "a/b", prNumber: "1", event: "comment", body: "x" }),
      ),
    /positive integer/,
  );
});

test("rejects unknown review event", () => {
  assert.throws(
    () =>
      parseGithubReviewPayload(
        action({ repo: "a/b", prNumber: 1, event: "merge", body: "x" }),
      ),
    /comment\|approve\|request_changes/,
  );
});

test("rejects empty body", () => {
  assert.throws(
    () =>
      parseGithubReviewPayload(
        action({ repo: "a/b", prNumber: 1, event: "comment", body: "   " }),
      ),
    /non-empty/,
  );
});
