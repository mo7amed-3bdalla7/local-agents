/**
 * Approximate per-million-token pricing for the cost cap. Numbers reflect
 * Anthropic's public list pricing for each model family; cache rates follow
 * the standard 10% read / 1.25x write multipliers documented at
 * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching.
 *
 * These are intentionally approximate — the cap is a guardrail against
 * runaway runs, not a billing-grade meter. If pricing changes, edit here.
 */

export interface ModelPricing {
  /** USD per 1M input tokens (non-cached). */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
  /** USD per 1M cache-creation input tokens (~1.25x base input). */
  cacheCreationPerMillion: number;
  /** USD per 1M cache-read input tokens (~0.10x base input). */
  cacheReadPerMillion: number;
}

/**
 * Keyed by lower-cased substring of the model id. Lookup matches the first
 * substring that appears in the model name, so `claude-opus-4-7-fast` resolves
 * to the same row as `claude-opus-4-7`.
 */
const TABLE: Array<[match: string, p: ModelPricing]> = [
  // Opus family
  [
    "opus",
    {
      inputPerMillion: 15,
      outputPerMillion: 75,
      cacheCreationPerMillion: 18.75,
      cacheReadPerMillion: 1.5,
    },
  ],
  // Sonnet family
  [
    "sonnet",
    {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheCreationPerMillion: 3.75,
      cacheReadPerMillion: 0.3,
    },
  ],
  // Haiku family
  [
    "haiku",
    {
      inputPerMillion: 1,
      outputPerMillion: 5,
      cacheCreationPerMillion: 1.25,
      cacheReadPerMillion: 0.1,
    },
  ],
];

export function pricingFor(model: string | undefined): ModelPricing | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  for (const [match, p] of TABLE) {
    if (m.includes(match)) return p;
  }
  return undefined;
}

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export function costForTurn(p: ModelPricing, u: TurnUsage): number {
  const inp = (u.inputTokens ?? 0) / 1_000_000;
  const out = (u.outputTokens ?? 0) / 1_000_000;
  const cw = (u.cacheCreationTokens ?? 0) / 1_000_000;
  const cr = (u.cacheReadTokens ?? 0) / 1_000_000;
  return (
    inp * p.inputPerMillion +
    out * p.outputPerMillion +
    cw * p.cacheCreationPerMillion +
    cr * p.cacheReadPerMillion
  );
}
