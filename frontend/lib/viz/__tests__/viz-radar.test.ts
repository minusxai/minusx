/**
 * minusx/radar@1 — the native-Vega tier's first recipe (RFC §16: radar is
 * inexpressible in Vega-Lite; no polar coordinates). The recipe materializes a
 * full Vega spec; rendering skips the VL compile and parses directly with the
 * themed Vega parser config (same token source, ast + interpreter as always).
 */
import { describe, it, expect } from 'vitest';
import { materializeRecipe, getTemplate } from '@/lib/viz/viz-templates';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { renderEnvelopeToSvg } from '@/lib/viz/render-vega';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from '@/lib/viz/types';

const COLUMNS: VizResultColumn[] = [
  { name: 'metric', kind: 'nominal' },
  { name: 'score', kind: 'quantitative' },
  { name: 'product', kind: 'nominal' },
];

const ROWS = [
  { metric: 'Speed', score: 82, product: 'A' },
  { metric: 'Quality', score: 91, product: 'A' },
  { metric: 'Price', score: 64, product: 'A' },
  { metric: 'Support', score: 70, product: 'A' },
  { metric: 'Speed', score: 60, product: 'B' },
  { metric: 'Quality', score: 75, product: 'B' },
  { metric: 'Price', score: 88, product: 'B' },
  { metric: 'Support', score: 50, product: 'B' },
];

const envelope = (bindings: Record<string, string>): VizEnvelope => ({
  version: 2,
  source: { kind: 'recipe', recipe: 'minusx/radar@1', bindings },
} as unknown as VizEnvelope);

describe('minusx/radar@1', () => {
  it('is registered with metric/value required and series optional', () => {
    const t = getTemplate('minusx/radar@1')!;
    expect(t.engine).toBe('vega');
    expect(t.bindings.map(b => [b.name, b.optional ?? false])).toEqual([
      ['metric', false], ['value', false], ['series', true],
    ]);
  });

  it('materializes a native Vega spec (marks/scales/signals, engine vega)', () => {
    const m = materializeRecipe({ recipe: 'minusx/radar@1', bindings: { metric: 'metric', value: 'score', series: 'product' } });
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.engine).toBe('vega');
      expect(Array.isArray(m.spec.marks)).toBe(true);
      expect(Array.isArray(m.spec.scales)).toBe(true);
    }
  });

  it('materializes without the optional series binding', () => {
    const m = materializeRecipe({ recipe: 'minusx/radar@1', bindings: { metric: 'metric', value: 'score' } });
    expect(m.ok).toBe(true);
  });

  it('validates the reference: ok with real columns, E_FIELD_NOT_FOUND otherwise', () => {
    expect(validateVizEnvelope(envelope({ metric: 'metric', value: 'score', series: 'product' }), COLUMNS).ok).toBe(true);
    const bad = validateVizEnvelope(envelope({ metric: 'metricc', value: 'score' }), COLUMNS);
    expect(bad.ok).toBe(false);
    expect(bad.issues.some(i => i.code === 'E_FIELD_NOT_FOUND')).toBe(true);
  });

  it('renders headlessly: series polygons, spokes, and metric labels', async () => {
    const svg = await renderEnvelopeToSvg(envelope({ metric: 'metric', value: 'score', series: 'product' }), ROWS, 'dark', { width: 420, height: 360 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('mark-line');  // series polygons
    expect(svg).toContain('mark-rule');  // spokes
    expect(svg).toContain('Speed');
    expect(svg).toContain('Support');
  });

  it('renders single-series without a series binding', async () => {
    const rows = ROWS.filter(r => r.product === 'A');
    const svg = await renderEnvelopeToSvg(envelope({ metric: 'metric', value: 'score' }), rows, 'dark', { width: 420, height: 360 });
    expect(svg).toContain('mark-line');
    expect(svg).toContain('Quality');
  });
});
