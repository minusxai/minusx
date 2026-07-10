/**
 * ValidateVisualization pipeline (RFC §11) — the agent feedback contract.
 * Written RED-first per house TDD; validateVizEnvelope is implemented against these.
 */
import { describe, it, expect } from 'vitest';
import { validateVizEnvelope } from '@/lib/viz/validate';
import type { VizResultColumn } from '@/lib/viz/types';

const COLUMNS: VizResultColumn[] = [
  { name: 'month', kind: 'temporal' },
  { name: 'revenue', kind: 'quantitative' },
  { name: 'margin_percentage', kind: 'quantitative' },
  { name: 'region', kind: 'nominal' },
];

const envelope = (spec: Record<string, unknown>) => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
});

const BAR_SPEC = {
  mark: 'bar',
  encoding: {
    x: { field: 'month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative' },
  },
};

describe('validateVizEnvelope', () => {
  it('accepts a simple valid bar spec against matching columns', () => {
    const result = validateVizEnvelope(envelope(BAR_SPEC), COLUMNS);
    expect(result.ok).toBe(true);
    expect(result.issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('rejects a wrong envelope version with E_ENVELOPE', () => {
    const result = validateVizEnvelope({ version: 3, source: envelope(BAR_SPEC).source }, COLUMNS);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'E_ENVELOPE')).toBe(true);
  });

  it('rejects an unknown source kind with E_ENVELOPE', () => {
    const result = validateVizEnvelope(
      { version: 2, source: { kind: 'vega', grammar: 'vega@6', spec: {} } },
      COLUMNS,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'E_ENVELOPE')).toBe(true);
  });

  it('rejects an invalid mark with E_SCHEMA and a path into the spec', () => {
    const result = validateVizEnvelope(envelope({ ...BAR_SPEC, mark: 'barr' }), COLUMNS);
    expect(result.ok).toBe(false);
    const schemaErr = result.issues.find(i => i.code === 'E_SCHEMA');
    expect(schemaErr).toBeDefined();
    expect(schemaErr!.path).toContain('/source/spec');
    // The distilled message must mention the offending value, not dump anyOf noise.
    expect(schemaErr!.message.length).toBeLessThan(500);
  });

  it('flags a misspelled field with E_FIELD_NOT_FOUND, path, and available fields', () => {
    const spec = {
      mark: 'bar',
      encoding: {
        x: { field: 'month', type: 'temporal' },
        y: { field: 'margin_pct', type: 'quantitative' },
      },
    };
    const result = validateVizEnvelope(envelope(spec), COLUMNS);
    expect(result.ok).toBe(false);
    const err = result.issues.find(i => i.code === 'E_FIELD_NOT_FOUND');
    expect(err).toBeDefined();
    expect(err!.path).toContain('encoding/y/field');
    expect(err!.message).toContain('margin_pct');
    expect(err!.message).toContain('margin_percentage'); // available fields listed
  });

  it('reports the correct layer path for a bad field inside a layered spec', () => {
    const spec = {
      layer: [
        { mark: 'bar', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'revenue', type: 'quantitative' } } },
        { mark: 'line', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'reevenue', type: 'quantitative' } } },
      ],
    };
    const result = validateVizEnvelope(envelope(spec), COLUMNS);
    const err = result.issues.find(i => i.code === 'E_FIELD_NOT_FOUND');
    expect(err).toBeDefined();
    expect(err!.path).toContain('/layer/1/');
  });

  it('allows references to transform-derived fields (fold outputs)', () => {
    const spec = {
      transform: [{ fold: ['revenue', 'margin_percentage'], as: ['metric', 'amount'] }],
      mark: 'bar',
      encoding: {
        x: { field: 'month', type: 'temporal' },
        y: { field: 'amount', type: 'quantitative' },
        color: { field: 'metric', type: 'nominal' },
      },
    };
    const result = validateVizEnvelope(envelope(spec), COLUMNS);
    expect(result.issues.filter(i => i.code === 'E_FIELD_NOT_FOUND')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects external data urls with E_EXTERNAL_DATA', () => {
    const spec = { ...BAR_SPEC, data: { url: 'https://example.com/data.json' } };
    const result = validateVizEnvelope(envelope(spec), COLUMNS);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'E_EXTERNAL_DATA')).toBe(true);
  });

  it('rejects inline data values with E_EXTERNAL_DATA (only the named dataset is allowed)', () => {
    const spec = { ...BAR_SPEC, data: { values: [{ month: 'Jan', revenue: 1 }] } };
    const result = validateVizEnvelope(envelope(spec), COLUMNS);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'E_EXTERNAL_DATA')).toBe(true);
  });

  it('rejects a foreign dataset name with E_DATASET_NAME', () => {
    const spec = { ...BAR_SPEC, data: { name: 'other' } };
    const result = validateVizEnvelope(envelope(spec), COLUMNS);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'E_DATASET_NAME')).toBe(true);
  });

  it('accepts an explicit data: {name: "main"}', () => {
    const spec = { ...BAR_SPEC, data: { name: 'main' } };
    const result = validateVizEnvelope(envelope(spec), COLUMNS);
    expect(result.ok).toBe(true);
  });

  it('captures vega-lite compiler warnings as W_COMPILE without flipping ok', () => {
    // `size` on a bar mark with a discrete x compiles but logs a warning-worthy drop;
    // the canonical warning case: an encoding channel VL warns about and ignores.
    const spec = {
      mark: 'bar',
      encoding: {
        x: { field: 'region', type: 'nominal' },
        y: { field: 'revenue', type: 'quantitative' },
        shape: { field: 'region', type: 'nominal' }, // shape is incompatible with bar → VL warns
      },
    };
    const result = validateVizEnvelope(envelope(spec), COLUMNS);
    expect(result.ok).toBe(true);
    expect(result.issues.some(i => i.code === 'W_COMPILE' && i.severity === 'warning')).toBe(true);
  });

  it('handles a dual-axis layered spec with independent scales (the combo case)', () => {
    const spec = {
      layer: [
        { mark: 'bar', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'revenue', type: 'quantitative' } } },
        { mark: 'line', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'margin_percentage', type: 'quantitative' } } },
      ],
      resolve: { scale: { y: 'independent' } },
    };
    const result = validateVizEnvelope(envelope(spec), COLUMNS);
    expect(result.ok).toBe(true);
  });
});
