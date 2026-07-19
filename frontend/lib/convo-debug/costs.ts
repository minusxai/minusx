/**
 * Cost assignment for the /debug viz: expected (approx tokens × $/token rates
 * under the clean-prefix caching model) and actual (recorded per-call usage).
 *
 * Caching recurrence over root-call index i:
 *   uncached(i) = assistantBar(i−1).tokens + Σ non-assistant bars with callIndex i
 *   cached(i)   = cached(i−1) + uncached(i−1)          (cached(0) = 0)
 * Uncached input is billed at the cacheWrite rate when the model has one (the
 * prefix is written to cache with the long TTL), else the plain input rate.
 *
 * Rates resolve per model: the server catalog first (`ConvoDebugInput.rates`),
 * then a usage-derived fallback (cost ÷ tokens from the conversation's own
 * recorded calls) for models the catalog doesn't know.
 */
import type { AssistantMessage, Usage } from '@/orchestrator/llm';
import type { BareTurnBar } from './turns';
import type {
  ActualCallRecord,
  BarCost,
  ConvoDebugInput,
  ConvoDebugTotals,
  CostSlice,
  ModelRates,
  TokenRates,
  TurnBar,
} from './types';

export function deriveRatesFromUsage(usage: Usage): TokenRates | null {
  if (usage.input <= 0 || usage.output <= 0) return null;
  const input = usage.cost.input / usage.input;
  const output = usage.cost.output / usage.output;
  return {
    input,
    output,
    cacheRead: usage.cacheRead > 0 ? usage.cost.cacheRead / usage.cacheRead : input,
    cacheWrite: usage.cacheWrite > 0 ? usage.cost.cacheWrite / usage.cacheWrite : input,
  };
}

/** Catalog rates, with per-model usage-derived fallback from the log. */
export function resolveRates(input: ConvoDebugInput): ModelRates {
  const resolved: ModelRates = { ...input.rates };
  for (const entry of input.log) {
    if (!('role' in entry) || entry.role !== 'assistant') continue;
    const msg = entry as AssistantMessage;
    if (resolved[msg.model]) continue;
    const derived = deriveRatesFromUsage(msg.usage);
    if (derived) resolved[msg.model] = derived;
    else if (!(msg.model in resolved)) resolved[msg.model] = null;
  }
  return resolved;
}

const usd = (tokens: number, rate: number | undefined): number | null =>
  rate === undefined ? null : tokens * rate;

function uncachedRate(r: TokenRates): number {
  return r.cacheWrite > 0 ? r.cacheWrite : r.input;
}

function expectedSlice(cached: number, uncached: number, r: TokenRates | null): CostSlice {
  const cachedUsd = r ? usd(cached, r.cacheRead) : null;
  const uncachedUsd = r ? usd(uncached, uncachedRate(r)) : null;
  return {
    cachedTokens: cached,
    uncachedTokens: uncached,
    cachedUsd,
    uncachedUsd,
    totalUsd: cachedUsd != null && uncachedUsd != null ? cachedUsd + uncachedUsd : null,
  };
}

function actualSlice(usage: Usage): CostSlice {
  return {
    cachedTokens: usage.cacheRead,
    uncachedTokens: usage.input + usage.cacheWrite,
    cachedUsd: usage.cost.cacheRead,
    uncachedUsd: usage.cost.input + usage.cost.cacheWrite,
    totalUsd: usage.cost.cacheRead + usage.cost.input + usage.cost.cacheWrite,
  };
}

export function applyCosts(
  bare: BareTurnBar[],
  calls: ActualCallRecord[],
  rates: ModelRates,
): { bars: TurnBar[]; totals: ConvoDebugTotals } {
  const rootCalls = calls.filter((c) => !c.isSubAgent);
  const rateKeys = Object.keys(rates);
  const modelFor = (i: number): string | undefined =>
    rootCalls[i]?.model ?? rootCalls[rootCalls.length - 1]?.model ?? rateKeys[0];
  const ratesFor = (i: number): TokenRates | null => {
    const model = modelFor(i);
    return model !== undefined ? rates[model] ?? null : null;
  };

  const maxCallIndex = bare.reduce((m, b) => Math.max(m, b.callIndex), rootCalls.length);
  const assistantTokens: number[] = [];
  const inputBarTokens: number[] = [];
  for (let i = 0; i <= maxCallIndex; i++) {
    assistantTokens[i] = bare.find((b) => b.type === 'assistant' && b.callIndex === i)?.tokens ?? 0;
    inputBarTokens[i] = bare
      .filter((b) => b.type !== 'assistant' && b.callIndex === i)
      .reduce((s, b) => s + b.tokens, 0);
  }
  // Caching recurrence.
  const uncached: number[] = [];
  const cached: number[] = [];
  for (let i = 0; i <= maxCallIndex; i++) {
    uncached[i] = (i > 0 ? assistantTokens[i - 1] : 0) + inputBarTokens[i];
    cached[i] = i > 0 ? cached[i - 1] + uncached[i - 1] : 0;
  }

  const seenInputBarForCall = new Set<number>();
  const bars: TurnBar[] = bare.map((bar) => {
    let cost: BarCost;
    if (bar.type === 'assistant') {
      const r = ratesFor(bar.callIndex);
      const call = rootCalls[bar.callIndex];
      cost = {
        kind: 'output',
        expected: { tokens: bar.tokens, totalUsd: r ? usd(bar.tokens, r.output) : null },
        actual: call ? { tokens: call.usage.output, totalUsd: call.usage.cost.output } : null,
      };
    } else {
      const i = bar.callIndex;
      const r = ratesFor(i);
      const call = rootCalls[i];
      // The FULL call slice is attributed to the call's first input-side bar;
      // any additional input-side bar of the same call carries only its own
      // tokens as uncached (the decomposition sums back to the call slice).
      const first = !seenInputBarForCall.has(i);
      seenInputBarForCall.add(i);
      cost = {
        kind: 'input',
        expected: first
          ? expectedSlice(cached[i], uncached[i] - (inputBarTokens[i] - bar.tokens), r)
          : expectedSlice(0, bar.tokens, r),
        actual: first && call ? actualSlice(call.usage) : null,
      };
    }
    return { ...bar, cost };
  });

  // ── Totals ──
  const anyMissingRates = rootCalls.length > 0 && rootCalls.some((_, i) => ratesFor(i) === null);
  let expectedTotalUsd: number | null = 0;
  for (let i = 0; i < rootCalls.length; i++) {
    const r = ratesFor(i);
    if (!r || anyMissingRates) { expectedTotalUsd = null; break; }
    expectedTotalUsd += cached[i] * r.cacheRead + uncached[i] * uncachedRate(r) + assistantTokens[i] * r.output;
  }

  // Expected Next Cost: extend the recurrence to call rootCalls.length with a
  // 0-length next user message (trailing bars already sit at that index).
  const next = rootCalls.length;
  const nextRates = ratesFor(next);
  const nextCached = next > 0 ? cached[next - 1] + uncached[next - 1] : 0;
  const nextUncached = (next > 0 ? assistantTokens[next - 1] : 0) + (inputBarTokens[next] ?? 0);
  const expectedNextUsd = nextRates
    ? nextCached * nextRates.cacheRead + nextUncached * uncachedRate(nextRates)
    : null;

  const totals: ConvoDebugTotals = {
    expectedTotalUsd,
    actualTotalUsd: calls.reduce((s, c) => s + c.usage.cost.total, 0),
    expectedNextUsd,
    cachedInputTokens: calls.reduce((s, c) => s + c.usage.cacheRead, 0),
    uncachedInputTokens: calls.reduce((s, c) => s + c.usage.input + c.usage.cacheWrite, 0),
    outputTokens: calls.reduce((s, c) => s + c.usage.output, 0),
    expectedTextTokens: bare.reduce(
      (s, b) => s + b.components.filter((c) => c.type !== 'SubAgentLLM').reduce((t, c) => t + (c.tokens - c.imageTokens), 0),
      0,
    ),
    expectedImageTokens: bare.reduce(
      (s, b) => s + b.components.reduce((t, c) => t + c.imageTokens, 0),
      0,
    ),
  };
  return { bars, totals };
}
