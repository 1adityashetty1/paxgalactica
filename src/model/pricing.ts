/**
 * What a call cost, from the tokens it used.
 *
 * The subscription path never needed this: the Agent SDK reports
 * `total_cost_usd` on every result. An HTTP call reports tokens and nothing
 * else, so the figure `stats`, the trace and the spend cap all read has to be
 * computed — and the spend cap makes it load-bearing rather than cosmetic.
 *
 * Anthropic first-party list prices, per million tokens. A cache read is a
 * tenth of the input rate and a five-minute cache write a quarter more, which
 * is the API's own arithmetic rather than a per-model figure.
 *
 * OpenRouter reports its own `usage.cost`, which is what it actually charged
 * and is preferred where present; this table is the fallback, keyed on the
 * model id with any `vendor/` prefix stripped.
 */

interface Price {
  inPerM: number;
  outPerM: number;
}

const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { inPerM: 10, outPerM: 50 },
  'claude-fable-5': { inPerM: 10, outPerM: 50 },
  'claude-opus-5-5': { inPerM: 4, outPerM: 20 },
  'claude-opus-5': { inPerM: 5, outPerM: 25 },
  'claude-opus-4-8': { inPerM: 5, outPerM: 25 },
  'claude-opus-4-7': { inPerM: 5, outPerM: 25 },
  'claude-opus-4-6': { inPerM: 5, outPerM: 25 },
  'claude-sonnet-5-5': { inPerM: 2, outPerM: 10 },
  'claude-sonnet-5': { inPerM: 2, outPerM: 10 },
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5': { inPerM: 1, outPerM: 5 },
};

const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.25;

export interface TokenUsage {
  /** Uncached input. */
  inTok: number;
  outTok: number;
  cacheReadTok?: number;
  cacheWriteTok?: number;
}

/**
 * The price row for a model id, or null for one this table does not know.
 * Accepts OpenRouter's slugs (`anthropic/claude-haiku-4.5`) and a dated id
 * (`claude-haiku-4-5-20251001`) by normalising both to the bare API id.
 */
export function priceFor(model: string): Price | null {
  const bare = model
    .replace(/^[\w-]+\//, '')
    .replace(/:[\w-]+$/, '')
    .replace(/\./g, '-')
    .replace(/-\d{8}$/, '');
  return PRICES[bare] ?? null;
}

/** Dollars, or null when the model is not in the table and nothing else said. */
export function costFor(model: string, usage: TokenUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const perTok = (perM: number) => perM / 1_000_000;
  return (
    usage.inTok * perTok(price.inPerM) +
    usage.outTok * perTok(price.outPerM) +
    (usage.cacheReadTok ?? 0) * perTok(price.inPerM) * CACHE_READ_FACTOR +
    (usage.cacheWriteTok ?? 0) * perTok(price.inPerM) * CACHE_WRITE_FACTOR
  );
}

/**
 * Roughly what a turn costs on the default tiers, for the estimate the
 * settings screen states before a player pastes a key. Measured on the
 * subscription path, whose `total_cost_usd` is computed at these same rates:
 * about $0.29 a turn (docs/architecture.md A.5). A guide, not a quote — a turn
 * spent talking costs more than one spent ending quietly, which costs nothing.
 */
export const ESTIMATED_USD_PER_TURN = 0.29;
