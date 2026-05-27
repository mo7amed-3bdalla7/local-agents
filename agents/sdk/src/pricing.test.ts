import { test } from "node:test";
import assert from "node:assert/strict";
import { costForTurn, pricingFor } from "./pricing.js";

test("pricingFor matches sonnet / opus / haiku substrings", () => {
  assert.equal(pricingFor("claude-sonnet-4-6")?.inputPerMillion, 3);
  assert.equal(pricingFor("claude-opus-4-7")?.inputPerMillion, 15);
  assert.equal(pricingFor("claude-haiku-4-5")?.inputPerMillion, 1);
});

test("pricingFor is case-insensitive and tolerant of suffixes", () => {
  assert.equal(pricingFor("Claude-Sonnet-4-6-Fast")?.outputPerMillion, 15);
});

test("pricingFor returns undefined for unknown models", () => {
  assert.equal(pricingFor("gpt-5"), undefined);
  assert.equal(pricingFor(undefined), undefined);
});

test("costForTurn weighs each token bucket by its rate", () => {
  const p = pricingFor("claude-sonnet-4-6")!;
  // 1M input @ $3, 1M output @ $15, 0 cache: should be $18 exactly.
  const cost = costForTurn(p, {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(cost, 18);
});

test("costForTurn handles missing buckets", () => {
  const p = pricingFor("claude-haiku-4-5")!;
  const cost = costForTurn(p, { outputTokens: 100 });
  // 100 * $5/1M = $0.0005
  assert.ok(Math.abs(cost - 0.0005) < 1e-9);
});
