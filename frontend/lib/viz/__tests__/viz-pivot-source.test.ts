/**
 * The `pivot` source kind (RFC §10): the second DOM-tier resident. Same css
 * contract as table (scoped overrides, no @import/url); the pivot STRUCTURE
 * (rows/columns/values) stays typed — the classic PivotConfig reused wholesale.
 */
import { describe, it, expect } from 'vitest';
import {
  getEnvelopeVizType, isEnvelopeEditable, getEnvelopeZones, setEnvelopeVizType,
  getPivotConfig, setPivotConfig,
  getVizCss, setVizCss, getVizColumnFormats, setVizColumnFormats,
  V2_SUPPORTED_VIZ_TYPES,
} from '@/lib/viz/encoding-edit';
import { validateVizEnvelope } from '@/lib/viz/validate';
import type { VizEnvelope, PivotConfig } from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from '@/lib/viz/types';

const CONFIG: PivotConfig = {
  rows: ['region'],
  columns: ['month'],
  values: [{ column: 'revenue', aggFunction: 'SUM' }],
};

const pivotEnvelope = (extra: Record<string, unknown> = {}): VizEnvelope => ({
  version: 2,
  source: { kind: 'pivot', config: CONFIG, columnFormats: null, css: null, ...extra },
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
  { name: 'month', kind: 'temporal' },
  { name: 'revenue', kind: 'quantitative' },
];

describe('pivot envelope classification', () => {
  it('classifies kind pivot as the pivot viz type', () => {
    expect(getEnvelopeVizType(pivotEnvelope())).toBe('pivot');
  });

  it('pivot is a supported (selectable) V2 type', () => {
    expect(V2_SUPPORTED_VIZ_TYPES).toContain('pivot');
  });

  it('pivot envelopes are editable and expose no generic zones (PivotAxisBuilder owns them)', () => {
    expect(isEnvelopeEditable(pivotEnvelope())).toBe(true);
    expect(getEnvelopeZones(pivotEnvelope())).toEqual([]);
  });
});

describe('switching to pivot (auto-init from columns)', () => {
  it('bar → pivot seeds rows from the category and values from the measure', () => {
    const next = setEnvelopeVizType(barEnvelope, 'pivot', COLUMNS);
    const source = next.source as unknown as { kind: string; config: PivotConfig };
    expect(source.kind).toBe('pivot');
    expect(source.config.rows).toEqual(['region']);
    expect(source.config.values).toEqual([{ column: 'revenue', aggFunction: 'SUM' }]);
  });

  it('table → pivot uses the columns fallback (table has no encodings)', () => {
    const table = { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } } as unknown as VizEnvelope;
    const next = setEnvelopeVizType(table, 'pivot', COLUMNS);
    const config = (next.source as unknown as { config: PivotConfig }).config;
    expect(config.rows).toEqual(['region']);
    expect(config.values).toEqual([{ column: 'revenue', aggFunction: 'SUM' }]);
  });
});

describe('switching away from pivot (structure feeds inference)', () => {
  it('pivot → bar picks rows[0] for x and values[0].column for y', () => {
    const next = setEnvelopeVizType(pivotEnvelope(), 'bar');
    const spec = (next.source as unknown as { spec: Record<string, any> }).spec;
    expect(spec.encoding.x.field).toBe('region');
    expect(spec.encoding.y.field).toBe('revenue');
  });
});

describe('pivot config + shared DOM-tier edits (surgical)', () => {
  it('get/setPivotConfig round-trips immutably', () => {
    const nextConfig: PivotConfig = { ...CONFIG, showHeatmap: true };
    const next = setPivotConfig(pivotEnvelope(), nextConfig);
    expect(getPivotConfig(next)).toEqual(nextConfig);
    expect(getPivotConfig(pivotEnvelope())).toEqual(CONFIG);
  });

  it('css helpers work for pivot (shared DOM-tier contract)', () => {
    const withCss = setVizCss(pivotEnvelope(), '.mx-pivot th { background: #222; }');
    expect(getVizCss(withCss)).toBe('.mx-pivot th { background: #222; }');
    expect(getVizCss(setVizCss(withCss, ' '))).toBeNull();
  });

  it('columnFormats helpers work for pivot', () => {
    const next = setVizColumnFormats(pivotEnvelope(), { revenue: { decimalPoints: 0, prefix: '$' } });
    expect(getVizColumnFormats(next)).toEqual({ revenue: { decimalPoints: 0, prefix: '$' } });
  });

  it('pivot setters are no-ops on non-DOM sources', () => {
    expect(setPivotConfig(barEnvelope, CONFIG)).toBe(barEnvelope);
    expect(setVizCss(barEnvelope, '.x{}')).toBe(barEnvelope);
  });
});

describe('validateVizEnvelope — pivot source', () => {
  const COLS: VizResultColumn[] = [
    { name: 'region', kind: 'nominal' },
    { name: 'month', kind: 'temporal' },
    { name: 'revenue', kind: 'quantitative' },
  ];

  it('accepts a well-formed pivot source', () => {
    const result = validateVizEnvelope(pivotEnvelope(), COLS);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags a values column not in the query result', () => {
    const bad = pivotEnvelope({ config: { ...CONFIG, values: [{ column: 'revenu', aggFunction: 'SUM' }] } });
    const result = validateVizEnvelope(bad, COLS);
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('E_FIELD_NOT_FOUND');
    expect(result.issues[0].path).toBe('/source/config/values/0/column');
    expect(result.issues[0].message).toContain('revenue');
  });

  it('flags a rows dimension not in the query result', () => {
    const bad = pivotEnvelope({ config: { ...CONFIG, rows: ['regio'] } });
    const result = validateVizEnvelope(bad, COLS);
    expect(result.ok).toBe(false);
    expect(result.issues[0].path).toBe('/source/config/rows/0');
  });

  it('rejects a pivot source without config', () => {
    const result = validateVizEnvelope(pivotEnvelope({ config: undefined }), COLS);
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('E_ENVELOPE');
  });

  it('applies the shared css policy (no url())', () => {
    const result = validateVizEnvelope(
      pivotEnvelope({ css: '.mx-pivot { background: url(https://x/y.png); }' }), COLS);
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('E_CSS');
  });
});
