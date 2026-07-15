/**
 * Radar with MULTIPLE value columns: a multi-capable recipe binding (value: string[])
 * folds the measures inside the vega data pipeline — each value column becomes a
 * series polygon. When multiple values are bound, the explicit series slot is
 * ignored (measures ARE the series).
 */
import { describe, it, expect } from 'vitest';
import { materializeRecipe, getTemplate } from '@/lib/viz/viz-templates';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { renderEnvelopeToSvg } from '@/lib/viz/render-vega';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from '@/lib/viz/types';

const COLUMNS: VizResultColumn[] = [
  { name: 'metric', kind: 'nominal' },
  { name: 'alpha_score', kind: 'quantitative' },
  { name: 'beta_score', kind: 'quantitative' },
];

const ROWS = [
  { metric: 'Speed', alpha_score: 82, beta_score: 60 },
  { metric: 'Quality', alpha_score: 91, beta_score: 75 },
  { metric: 'Price', alpha_score: 64, beta_score: 88 },
  { metric: 'Support', alpha_score: 70, beta_score: 50 },
];

const envelope = (bindings: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'recipe', recipe: 'minusx/radar@1', bindings },
} as unknown as VizEnvelope);

describe('radar multi-value', () => {
  it('declares the value slot as multi', () => {
    const t = getTemplate('minusx/radar@1')!;
    expect(t.bindings.find(b => b.name === 'value')!.multi).toBe(true);
  });

  it('materializes a fold over the value columns', () => {
    const m = materializeRecipe({ recipe: 'minusx/radar@1', bindings: { metric: 'metric', value: ['alpha_score', 'beta_score'] } as never });
    expect(m.ok).toBe(true);
    if (m.ok) {
      const table = (m.spec.data as Array<{ name: string; transform?: unknown[] }>).find(d => d.name === 'table')!;
      expect(JSON.stringify(table.transform)).toContain('"fold"');
    }
  });

  it('validates each bound column in a multi binding', () => {
    const bad = validateVizEnvelope(envelope({ metric: 'metric', value: ['alpha_score', 'nope'] }), COLUMNS);
    expect(bad.ok).toBe(false);
    expect(bad.issues.some(i => i.code === 'E_FIELD_NOT_FOUND' && i.message.includes('nope'))).toBe(true);
    expect(validateVizEnvelope(envelope({ metric: 'metric', value: ['alpha_score', 'beta_score'] }), COLUMNS).ok).toBe(true);
  });

  it('renders two series polygons from two value columns', async () => {
    const svg = await renderEnvelopeToSvg(envelope({ metric: 'metric', value: ['alpha_score', 'beta_score'] }), ROWS, 'dark', { width: 420, height: 360 });
    expect(svg).toContain('mark-line');
    expect(svg).toContain('alpha_score'); // legend carries the measure names
    expect(svg).toContain('beta_score');
  });

  it('single value in array form behaves like the plain binding', async () => {
    const svg = await renderEnvelopeToSvg(envelope({ metric: 'metric', value: ['alpha_score'] }), ROWS, 'dark', { width: 420, height: 360 });
    expect(svg).toContain('mark-line');
  });
});
