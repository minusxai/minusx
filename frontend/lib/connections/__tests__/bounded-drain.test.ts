/**
 * drainQueryStreamBounded — bounded materialization with real backpressure. It must stop pulling
 * once a row/byte budget is hit (so the connector cursor stops too), and report `truncated`.
 */
import { describe, it, expect } from 'vitest';
import { drainQueryStreamBounded, type QueryStream } from '@/lib/connections/base';

/** A stream that records how many rows were actually PULLED (to prove early-stop = backpressure). */
function countingStream(total: number): { stream: QueryStream; pulled: () => number } {
  let pulled = 0;
  async function* gen() {
    for (let i = 0; i < total; i++) { pulled++; yield { i, pad: 'x'.repeat(20) }; }
  }
  return {
    stream: { columns: ['i', 'pad'], types: ['number', 'text'], finalQuery: 'q', rows: gen() },
    pulled: () => pulled,
  };
}

describe('drainQueryStreamBounded', () => {
  it('drains everything when under budget; truncated=false', async () => {
    const { stream } = countingStream(5);
    const r = await drainQueryStreamBounded(stream, { maxRows: 100, maxBytes: 1_000_000 });
    expect(r.rows.length).toBe(5);
    expect(r.truncated).toBe(false);
    expect(r.columns).toEqual(['i', 'pad']);
  });

  it('stops at maxRows and does NOT pull beyond it (+1 lookahead) — backpressure holds', async () => {
    const { stream, pulled } = countingStream(1000);
    const r = await drainQueryStreamBounded(stream, { maxRows: 10 });
    expect(r.rows.length).toBe(10);
    expect(r.truncated).toBe(true);
    // The generator is pulled at most one past the cap (the row that trips the check), never all 1000.
    expect(pulled()).toBeLessThanOrEqual(11);
  });

  it('stops at maxBytes', async () => {
    const { stream } = countingStream(10_000);
    // each row ≈ ~40 bytes of JSON; cap at 1KB → ~20-30 rows, well under 10k.
    const r = await drainQueryStreamBounded(stream, { maxBytes: 1024 });
    expect(r.truncated).toBe(true);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.length).toBeLessThan(100);
  });

  it('always keeps at least one row even if that row exceeds the byte budget', async () => {
    async function* gen() { yield { big: 'z'.repeat(5000) }; }
    const stream: QueryStream = { columns: ['big'], types: ['text'], finalQuery: 'q', rows: gen() };
    const r = await drainQueryStreamBounded(stream, { maxBytes: 10 });
    expect(r.rows.length).toBe(1);
    expect(r.truncated).toBe(true);
  });

  it('empty result → no rows, not truncated', async () => {
    const { stream } = countingStream(0);
    const r = await drainQueryStreamBounded(stream, { maxRows: 10 });
    expect(r.rows).toEqual([]);
    expect(r.truncated).toBe(false);
  });
});
