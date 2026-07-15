/**
 * Viz inference tests — every row of the shape-rules table, alias parity with
 * the compiler's SELECT aliases (so the two can't drift), table-always, and
 * purity/determinism.
 */
import { describe, it, expect } from 'vitest';
import { inferVizForSpec, autoVizForSpec } from '../infer-viz';
import { compileSemanticQuery } from '../compile';
import type { SemanticModel } from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

const ORDERS_MODEL: SemanticModel = {
  name: 'Orders',
  connection: 'warehouse',
  schema: 'analytics',
  table: 'orders',
  timeDimension: { column: 'created_at', label: 'Order date' },
  dimensions: [
    { name: 'Status', column: 'status' },
    { name: 'Zone', column: 'zone' },
    { name: 'Platform', column: 'platform' },
  ],
  measures: [
    { name: 'Revenue', agg: 'SUM', column: 'amount' },
    { name: 'Orders', agg: 'COUNT' },
  ],
};

const spec = (overrides: Partial<SemanticQuerySpec> = {}): SemanticQuerySpec => ({
  model: 'Orders',
  measures: ['Revenue'],
  dimensions: [],
  ...overrides,
});

const types = (s: SemanticQuerySpec) => inferVizForSpec(s, ORDERS_MODEL).map((m) => m.type);

describe('inferVizForSpec — shape rules', () => {
  it('time + measures, no dims → line, area, bar, table', () => {
    expect(types(spec({ timeGrain: 'WEEK' }))).toEqual(['line', 'area', 'bar', 'table']);
  });

  it('time + measures + 1 dim → line with series split, then area, table', () => {
    const ranked = inferVizForSpec(spec({ timeGrain: 'MONTH', dimensions: ['Status'] }), ORDERS_MODEL);
    expect(ranked.map((m) => m.type)).toEqual(['line', 'area', 'table']);
    expect(ranked[0].xCols).toEqual(['month', 'status']);
    expect(ranked[0].yCols).toEqual(['revenue']);
  });

  it('time + measures + 2+ dims → table first (series explosion), line still offered', () => {
    expect(types(spec({ timeGrain: 'DAY', dimensions: ['Status', 'Zone'] })))
      .toEqual(['table', 'line']);
  });

  it('1 dim + 1 measure → bar, row, pie, table', () => {
    expect(types(spec({ dimensions: ['Status'] }))).toEqual(['bar', 'row', 'pie', 'table']);
  });

  it('2 dims + 1 measure → bar, row, table (no pie beyond one dim)', () => {
    expect(types(spec({ dimensions: ['Status', 'Zone'] }))).toEqual(['bar', 'row', 'table']);
  });

  it('1 dim + exactly 2 measures → scatter (measure vs measure), bar, table', () => {
    const ranked = inferVizForSpec(spec({ measures: ['Revenue', 'Orders'], dimensions: ['Status'] }), ORDERS_MODEL);
    expect(ranked.map((m) => m.type)).toEqual(['scatter', 'bar', 'table']);
    expect(ranked[0].xCols).toEqual(['revenue']);
    expect(ranked[0].yCols).toEqual(['orders']);
    // the bar fallback keeps the dimension on x with both measures on y
    expect(ranked[1].xCols).toEqual(['status']);
    expect(ranked[1].yCols).toEqual(['revenue', 'orders']);
  });

  it('dims + 2+ measures (not the scatter shape) → bar grouped, table', () => {
    expect(types(spec({ measures: ['Revenue', 'Orders'], dimensions: ['Status', 'Zone'] })))
      .toEqual(['bar', 'table']);
  });

  it('exactly one measure alone → single_value, table', () => {
    const ranked = inferVizForSpec(spec(), ORDERS_MODEL);
    expect(ranked.map((m) => m.type)).toEqual(['single_value', 'table']);
    expect(ranked[0].xCols).toEqual([]);
    expect(ranked[0].yCols).toEqual(['revenue']);
  });

  it('two measures alone → table, bar', () => {
    expect(types(spec({ measures: ['Revenue', 'Orders'] }))).toEqual(['table', 'bar']);
  });

  it('empty / measureless spec → just table', () => {
    expect(types(spec({ measures: [] }))).toEqual(['table']);
    expect(types({ model: 'Orders', measures: [], dimensions: ['Status'] })).toEqual(['table']);
  });
});

describe('inferVizForSpec — invariants', () => {
  const CASES: SemanticQuerySpec[] = [
    spec(),
    spec({ timeGrain: 'WEEK' }),
    spec({ timeGrain: 'MONTH', dimensions: ['Status'] }),
    spec({ dimensions: ['Status'] }),
    spec({ measures: ['Revenue', 'Orders'], dimensions: ['Status'] }),
    spec({ measures: [] }),
  ];

  it('table is always a match; scores are positive and strictly ranked', () => {
    for (const s of CASES) {
      const ranked = inferVizForSpec(s, ORDERS_MODEL);
      expect(ranked.map((m) => m.type)).toContain('table');
      for (const m of ranked) expect(m.score).toBeGreaterThan(0);
      const scores = ranked.map((m) => m.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    }
  });

  it('is deterministic and does not mutate the spec', () => {
    const s = spec({ timeGrain: 'MONTH', dimensions: ['Status'] });
    const frozen = JSON.parse(JSON.stringify(s));
    expect(inferVizForSpec(s, ORDERS_MODEL)).toEqual(inferVizForSpec(s, ORDERS_MODEL));
    expect(s).toEqual(frozen);
  });

  it('autoVizForSpec returns the first ranked match', () => {
    const s = spec({ timeGrain: 'WEEK' });
    expect(autoVizForSpec(s, ORDERS_MODEL)).toEqual(inferVizForSpec(s, ORDERS_MODEL)[0]);
  });
});

describe('inferVizForSpec — alias parity with compileSemanticQuery', () => {
  it('xCols/yCols use exactly the SELECT aliases the compiler emits', () => {
    const s = spec({ measures: ['Revenue', 'Orders'], dimensions: ['Status'], timeGrain: 'MONTH' });
    const ir = compileSemanticQuery(s, ORDERS_MODEL);
    const selectAliases = ir.select.map((c) => c.alias);
    const auto = autoVizForSpec(s, ORDERS_MODEL);
    for (const col of [...auto.xCols, ...auto.yCols]) {
      expect(selectAliases).toContain(col);
    }
  });
});
