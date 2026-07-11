/**
 * The `table` source kind (RFC §10): tables stay DOM (TableV2), never vega. The
 * envelope persists only display formatting; everything else (sort/filter/visibility/
 * stats/CSV/drilldown) is ephemeral TableV2 state and comes free from reuse.
 */
import { describe, it, expect } from 'vitest';
import {
  getEnvelopeVizType, isEnvelopeEditable, getEnvelopeZones, setEnvelopeVizType,
  getVizColumnFormats, setVizColumnFormats,
  getTableConditionalFormats, setTableConditionalFormats,
  getVizCss, setVizCss,
  V2_SUPPORTED_VIZ_TYPES,
} from '@/lib/viz/encoding-edit';
import { validateVizEnvelope } from '@/lib/viz/validate';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from '@/lib/viz/types';

const tableEnvelope = (extra: Record<string, unknown> = {}): VizEnvelope => ({
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, ...extra },
}) as unknown as VizEnvelope;

const barEnvelope: VizEnvelope = {
  version: 2,
  source: {
    kind: 'vega-lite',
    grammar: 'vega-lite@6',
    spec: {
      mark: { type: 'bar' },
      encoding: {
        x: { field: 'region', type: 'nominal' },
        y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
      },
    },
  },
} as unknown as VizEnvelope;

const COLUMNS: Array<{ name: string; kind: VizResultColumn['kind'] }> = [
  { name: 'region', kind: 'nominal' },
  { name: 'revenue', kind: 'quantitative' },
];

describe('table envelope classification', () => {
  it('classifies kind table as the table viz type', () => {
    expect(getEnvelopeVizType(tableEnvelope())).toBe('table');
  });

  it('table is a supported (selectable) V2 type', () => {
    expect(V2_SUPPORTED_VIZ_TYPES).toContain('table');
  });

  it('table envelopes are editable (panel renders, not the CUSTOM hint)', () => {
    expect(isEnvelopeEditable(tableEnvelope())).toBe(true);
  });

  it('table has no drop zones — columns are managed on the table itself', () => {
    expect(getEnvelopeZones(tableEnvelope())).toEqual([]);
  });
});

describe('switching to table', () => {
  it('bar → table produces a clean table source', () => {
    const next = setEnvelopeVizType(barEnvelope, 'table');
    expect(next.source).toEqual({ kind: 'table', columnFormats: null, conditionalFormats: null, css: null });
  });
});

describe('switching away from table (columns fallback inference)', () => {
  it('table → bar picks the first non-quantitative column for x, first quantitative for y', () => {
    const next = setEnvelopeVizType(tableEnvelope(), 'bar', COLUMNS);
    const spec = (next.source as unknown as { spec: Record<string, any> }).spec;
    expect(spec.mark.type).toBe('bar');
    expect(spec.encoding.x.field).toBe('region');
    expect(spec.encoding.y.field).toBe('revenue');
  });

  it('table → funnel fills the recipe bindings from the columns', () => {
    const next = setEnvelopeVizType(tableEnvelope(), 'funnel', COLUMNS);
    const source = next.source as unknown as { kind: string; recipe: string; bindings: Record<string, string> };
    expect(source.kind).toBe('recipe');
    expect(source.bindings).toEqual({ stage: 'region', value: 'revenue' });
  });

  it('table → bar without columns yields empty encodings (user drops columns in)', () => {
    const next = setEnvelopeVizType(tableEnvelope(), 'bar');
    const spec = (next.source as unknown as { spec: Record<string, any> }).spec;
    expect(spec.mark.type).toBe('bar');
    expect(spec.encoding.x).toBeUndefined();
    expect(spec.encoding.y).toBeUndefined();
  });
});

describe('table format edits (surgical)', () => {
  it('setVizColumnFormats writes formats; getVizColumnFormats reads them back', () => {
    const next = setVizColumnFormats(tableEnvelope(), { revenue: { alias: 'Revenue ($)', decimalPoints: 2 } });
    expect(getVizColumnFormats(next)).toEqual({ revenue: { alias: 'Revenue ($)', decimalPoints: 2 } });
    // Original untouched (immutably cloned)
    expect(getVizColumnFormats(tableEnvelope())).toEqual({});
  });

  it('setTableConditionalFormats writes rules; empty list clears to null', () => {
    const rule = { id: 'r1', column: 'revenue', operator: '>' as const, value: '100', target: 'cell' as const, bgColor: '#fde68a' };
    const withRule = setTableConditionalFormats(tableEnvelope(), [rule]);
    expect(getTableConditionalFormats(withRule)).toEqual([rule]);
    const cleared = setTableConditionalFormats(withRule, []);
    expect(getTableConditionalFormats(cleared)).toEqual([]);
    expect((cleared.source as unknown as Record<string, unknown>).conditionalFormats).toBeNull();
  });

  it('format setters are no-ops on non-table sources', () => {
    expect(setVizColumnFormats(barEnvelope, { x: { alias: 'nope' } })).toBe(barEnvelope);
  });

  it('setVizCss writes the css override; empty/whitespace clears to null', () => {
    const withCss = setVizCss(tableEnvelope(), '.mx-th { background: #222; }');
    expect(getVizCss(withCss)).toBe('.mx-th { background: #222; }');
    const cleared = setVizCss(withCss, '   ');
    expect(getVizCss(cleared)).toBeNull();
    expect((cleared.source as unknown as Record<string, unknown>).css).toBeNull();
  });
});

describe('validateVizEnvelope — table source', () => {
  const COLS: VizResultColumn[] = [
    { name: 'region', kind: 'nominal' },
    { name: 'revenue', kind: 'quantitative' },
  ];

  it('accepts a bare table source', () => {
    const result = validateVizEnvelope(tableEnvelope(), COLS);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts columnFormats keyed by real result columns', () => {
    const result = validateVizEnvelope(
      tableEnvelope({ columnFormats: { revenue: { alias: 'Revenue' } } }), COLS);
    expect(result.ok).toBe(true);
  });

  it('flags a columnFormats key that is not in the query result', () => {
    const result = validateVizEnvelope(
      tableEnvelope({ columnFormats: { revenu: { alias: 'typo' } } }), COLS);
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('E_FIELD_NOT_FOUND');
    expect(result.issues[0].path).toBe('/source/columnFormats/revenu');
    expect(result.issues[0].message).toContain('region');
  });

  it('accepts css written against the class contract', () => {
    const result = validateVizEnvelope(
      tableEnvelope({ css: '.mx-th { background: #222; font-size: 14px; } .mx-toolbar { display: none; }' }), COLS);
    expect(result.ok).toBe(true);
  });

  it('rejects @import and external url() in css', () => {
    for (const css of ['@import url("https://evil.example/x.css");', '.mx-th { background: url(https://evil.example/p.png); }']) {
      const result = validateVizEnvelope(tableEnvelope({ css }), COLS);
      expect(result.ok).toBe(false);
      expect(result.issues[0].code).toBe('E_CSS');
    }
  });
});
