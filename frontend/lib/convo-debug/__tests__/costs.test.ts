import { describe, it, expect } from 'vitest';
import { buildTurnBars } from '@/lib/convo-debug/turns';
import { deriveRatesFromUsage, resolveRates, applyCosts } from '@/lib/convo-debug/costs';
import { extractActualCalls } from '@/lib/convo-debug/actual';
import { makeInput, user, assistant, toolResult, rootInvocation, logEntry, usage, RATES, MODEL } from './fixtures';

const R = RATES[MODEL]!;

describe('deriveRatesFromUsage', () => {
  it('derives $/token rates from a usage record', () => {
    const u = usage(
      { input: 100, output: 50, cacheRead: 200, cacheWrite: 80 },
      { input: 300e-6, output: 750e-6, cacheRead: 60e-6, cacheWrite: 300e-6, total: 0 },
    );
    const rates = deriveRatesFromUsage(u)!;
    expect(rates.input).toBeCloseTo(3e-6, 12);
    expect(rates.output).toBeCloseTo(15e-6, 12);
    expect(rates.cacheRead).toBeCloseTo(0.3e-6, 12);
    expect(rates.cacheWrite).toBeCloseTo(3.75e-6, 12);
  });

  it('falls back to the input rate for zero-token cache components', () => {
    const u = usage({ input: 100, output: 50 }, { input: 300e-6, output: 750e-6 });
    const rates = deriveRatesFromUsage(u);
    expect(rates?.cacheRead).toBeCloseTo(3e-6, 12);
    expect(rates?.cacheWrite).toBeCloseTo(3e-6, 12);
  });

  it('returns null when input or output tokens are zero', () => {
    expect(deriveRatesFromUsage(usage())).toBeNull();
  });
});

describe('resolveRates', () => {
  it('keeps catalog rates and fills missing models from usage records in the log', () => {
    const call = assistant([{ type: 'text', text: 'x' }], {
      model: 'other-model',
      usage: usage({ input: 100, output: 50 }, { input: 300e-6, output: 750e-6 }),
    });
    const input = makeInput({
      rates: { ...RATES, 'other-model': null },
      log: [rootInvocation('r1'), logEntry(call, 'r1')],
    });
    const resolved = resolveRates(input);
    expect(resolved[MODEL]).toEqual(R);
    const derived = resolved['other-model']!;
    expect(derived.input).toBeCloseTo(3e-6, 12);
    expect(derived.output).toBeCloseTo(15e-6, 12);
    expect(derived.cacheRead).toBeCloseTo(3e-6, 12);
    expect(derived.cacheWrite).toBeCloseTo(3e-6, 12);
  });
});

/** 2-call conversation with exact approx-token sizes (chars/4):
 *  input bar 100 tokens → assistant 50 → toolResults 100 → assistant 10. */
function twoCallInput() {
  const a1 = assistant(
    [{ type: 'toolCall', id: 't1', name: 'ExecuteQuery', arguments: {} }],
    {
      stopReason: 'toolUse',
      usage: usage(
        { input: 5, output: 55, cacheRead: 0, cacheWrite: 110 },
        { input: 15e-6, output: 825e-6, cacheRead: 0, cacheWrite: 412.5e-6, total: 1252.5e-6 },
      ),
    },
  );
  const a2 = assistant([{ type: 'text', text: 'd'.repeat(40) }], {
    usage: usage(
      { input: 10, output: 12, cacheRead: 115, cacheWrite: 140 },
      { input: 30e-6, output: 180e-6, cacheRead: 34.5e-6, cacheWrite: 525e-6, total: 769.5e-6 },
    ),
  });
  // The toolCall JSON dominates a1's approx size; pin the expected-output tokens
  // via the components instead of hand-computing JSON length in assertions.
  return makeInput({
    messages: [
      user('a'.repeat(400)),
      a1,
      toolResult('t1', 'ExecuteQuery', 'c'.repeat(400)),
      a2,
    ],
    log: [rootInvocation('r1'), logEntry(a1, 'r1'), logEntry(toolResult('t1', 'ExecuteQuery', 'c'.repeat(400)), 'r1'), logEntry(a2, 'r1')],
  });
}

describe('applyCosts — caching model', () => {
  it('call 0 is fully uncached; call i caches call i−1 full input; costs use cacheWrite/cacheRead rates', () => {
    const input = twoCallInput();
    const bare = buildTurnBars(input);
    const calls = extractActualCalls(input.log);
    const { bars, totals } = applyCosts(bare, calls, resolveRates(input));

    const [inputBar, assistantBar1, trBar, assistantBar2] = bars;
    const inputTokens = inputBar.tokens;      // 100
    const a1Tokens = assistantBar1.tokens;    // toolCall JSON approx
    const trTokens = trBar.tokens;            // 100
    expect(inputTokens).toBe(100);
    expect(trTokens).toBe(100);

    // Bar 0 — call 0 input: all uncached, billed at cacheWrite rate.
    expect(inputBar.cost.kind).toBe('input');
    if (inputBar.cost.kind !== 'input') return;
    expect(inputBar.cost.expected.cachedTokens).toBe(0);
    expect(inputBar.cost.expected.uncachedTokens).toBe(inputTokens);
    expect(inputBar.cost.expected.uncachedUsd).toBeCloseTo(inputTokens * R.cacheWrite, 12);
    // Actual from the recorded usage: uncached = input + cacheWrite.
    expect(inputBar.cost.actual?.uncachedTokens).toBe(115);
    expect(inputBar.cost.actual?.cachedTokens).toBe(0);
    expect(inputBar.cost.actual?.totalUsd).toBeCloseTo(15e-6 + 412.5e-6, 12);

    // Bar 1 — call 0 output.
    expect(assistantBar1.cost.kind).toBe('output');
    if (assistantBar1.cost.kind !== 'output') return;
    expect(assistantBar1.cost.expected.totalUsd).toBeCloseTo(a1Tokens * R.output, 12);
    expect(assistantBar1.cost.actual).toEqual({ tokens: 55, totalUsd: 825e-6 });

    // Bar 2 — call 1 input: cached = call 0's full input; uncached = assistant 0 output + tool results.
    expect(trBar.cost.kind).toBe('input');
    if (trBar.cost.kind !== 'input') return;
    expect(trBar.cost.expected.cachedTokens).toBe(inputTokens);
    expect(trBar.cost.expected.uncachedTokens).toBe(a1Tokens + trTokens);
    expect(trBar.cost.expected.cachedUsd).toBeCloseTo(inputTokens * R.cacheRead, 12);
    expect(trBar.cost.expected.uncachedUsd).toBeCloseTo((a1Tokens + trTokens) * R.cacheWrite, 12);
    expect(trBar.cost.actual?.cachedTokens).toBe(115);
    expect(trBar.cost.actual?.uncachedTokens).toBe(150);

    // Bar 3 — call 1 output.
    if (assistantBar2.cost.kind !== 'output') return;
    expect(assistantBar2.cost.actual).toEqual({ tokens: 12, totalUsd: 180e-6 });

    // Totals.
    const expectedCall0 = inputTokens * R.cacheWrite + a1Tokens * R.output;
    const expectedCall1 = inputTokens * R.cacheRead + (a1Tokens + trTokens) * R.cacheWrite + assistantBar2.tokens * R.output;
    expect(totals.expectedTotalUsd).toBeCloseTo(expectedCall0 + expectedCall1, 12);
    expect(totals.actualTotalUsd).toBeCloseTo(1252.5e-6 + 769.5e-6, 12);
    expect(totals.cachedInputTokens).toBe(115);
    expect(totals.uncachedInputTokens).toBe(115 + 150);
    expect(totals.outputTokens).toBe(67);

    // Expected Next Cost (0-length next user msg): cache covers call 1's full
    // input; uncached = assistant 1's output only.
    const nextCached = (inputTokens + a1Tokens + trTokens) * R.cacheRead;
    const nextUncached = assistantBar2.tokens * R.cacheWrite;
    expect(totals.expectedNextUsd).toBeCloseTo(nextCached + nextUncached, 12);
  });

  it('a trailing input bar (next app state + user msg) joins the hypothetical next call', () => {
    const a1 = assistant([{ type: 'text', text: 'b'.repeat(200) }], {
      usage: usage({ input: 100, output: 50 }, { input: 300e-6, output: 750e-6, total: 1050e-6 }),
    });
    const input = makeInput({
      messages: [user('a'.repeat(400)), a1, user('e'.repeat(200))],
      log: [rootInvocation('r1'), logEntry(a1, 'r1')],
    });
    const bare = buildTurnBars(input);
    const { bars, totals } = applyCosts(bare, extractActualCalls(input.log), resolveRates(input));
    const trailing = bars[2];
    expect(trailing.callIndex).toBe(1);
    if (trailing.cost.kind !== 'input') return;
    // Next call: cached = call 0 input (100); uncached = assistant output (50) + trailing (50).
    expect(trailing.cost.expected.cachedTokens).toBe(100);
    expect(trailing.cost.expected.uncachedTokens).toBe(100);
    expect(trailing.cost.actual).toBeNull();
    expect(totals.expectedNextUsd).toBeCloseTo(100 * R.cacheRead + 100 * R.cacheWrite, 12);
    // The un-run next call is NOT part of expected total.
    expect(totals.expectedTotalUsd).toBeCloseTo(100 * R.cacheWrite + 50 * R.output, 12);
  });

  it('yields null USD (tokens-only) when no rates resolve, without breaking token math', () => {
    const a1 = assistant([{ type: 'text', text: 'hi' }], { model: 'unknown-model' });
    const input = makeInput({
      rates: { 'unknown-model': null },
      messages: [user('q'), a1],
      log: [rootInvocation('r1'), logEntry(a1, 'r1')],
    });
    const bare = buildTurnBars(input);
    const { bars, totals } = applyCosts(bare, extractActualCalls(input.log), resolveRates(input));
    if (bars[0].cost.kind !== 'input') return;
    expect(bars[0].cost.expected.uncachedTokens).toBeGreaterThan(0);
    expect(bars[0].cost.expected.uncachedUsd).toBeNull();
    expect(totals.expectedTotalUsd).toBeNull();
    expect(totals.expectedNextUsd).toBeNull();
  });

  it('splits expected tokens into text vs image totals', () => {
    const input = makeInput({
      messages: [{
        role: 'user',
        timestamp: 1,
        content: [
          { type: 'text', text: 'x'.repeat(400) },
          { type: 'image', url: 'https://example.com/a.png' },
        ],
      }],
    });
    const bare = buildTurnBars(input);
    const { totals } = applyCosts(bare, [], resolveRates(input));
    expect(totals.expectedTextTokens).toBe(100);
    expect(totals.expectedImageTokens).toBe(1000);
  });
});
