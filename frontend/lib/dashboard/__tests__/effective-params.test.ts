// Dashboard parameter merging — the precedence + the key-existence rule that keeps an explicit
// None/'' from being resurrected by a question default. Extracted from DashboardView so it's testable.
import { describe, it, expect } from 'vitest';
import { computeEffectiveSubmittedValues } from '../effective-params';

const params = (...names: string[]) => names.map((name) => ({ name }));

describe('computeEffectiveSubmittedValues — dashboard parameter merging', () => {
  it('the dashboard-submitted value (lastExecutedParams) wins over dashboard values and question defaults', () => {
    const out = computeEffectiveSubmittedValues(
      params('region'),
      { region: 'east' },                 // submitted
      { region: 'west' },                 // dashboard param values
      new Map([['region', 'south']]),     // question default
    );
    expect(out.region).toBe('east');
  });

  it('falls back to the dashboard param value when the key was not submitted', () => {
    const out = computeEffectiveSubmittedValues(params('region'), {}, { region: 'west' }, new Map([['region', 'south']]));
    expect(out.region).toBe('west');
  });

  it("falls back to the question's own default when the key is absent from both dashboard tiers", () => {
    const out = computeEffectiveSubmittedValues(params('region'), {}, {}, new Map([['region', 'south']]));
    expect(out.region).toBe('south');
  });

  it("defaults to '' when nothing supplies a value", () => {
    const out = computeEffectiveSubmittedValues(params('region'), {}, {}, new Map());
    expect(out.region).toBe('');
  });

  it('preserves an explicit None (null) — a submitted null is NOT overridden by the question default', () => {
    const out = computeEffectiveSubmittedValues(
      params('region'),
      { region: null },                   // explicit None
      {},
      new Map([['region', 'south']]),     // default must NOT win
    );
    expect(out.region).toBeNull();
  });

  it("preserves an explicit empty string — '' is a real value, not a missing key", () => {
    const out = computeEffectiveSubmittedValues(params('region'), { region: '' }, {}, new Map([['region', 'south']]));
    expect(out.region).toBe('');
  });

  it('resolves each merged parameter independently by name', () => {
    const out = computeEffectiveSubmittedValues(
      params('a', 'b', 'c'),
      { a: 1 },
      { b: 2 },
      new Map([['c', 3]]),
    );
    expect(out).toEqual({ a: 1, b: 2, c: 3 });
  });
});
