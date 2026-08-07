/**
 * Radar and heatmap ship as WORKSPACE RECIPE FILES seeded by the workspace
 * template — user-layer documents (editable, deletable, shadowable), not code.
 * These tests pin that the template carries them in both mode roots and that
 * their templates actually materialize and RENDER. The shipped `minusx/radar@1`
 * registry entry stays for saved charts (live references must not break) — only
 * the offering moved to files.
 */
import { describe, it, expect } from 'vitest';
import template from '@/lib/database/workspace-template.json';
import { materializeFileRecipe, sampleDataForRecipe, type VizRecipeContent } from '@/lib/viz/recipe-file';
import { validateFileState } from '@/lib/validation/content-validators';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { renderVegaLiteToSvg } from '@/lib/viz/render-vega';
import { VIZ_GRAMMAR_VEGA, VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';
import { parse as parseVega } from 'vega';

type TemplateDoc = { path: string; type: string; content: unknown };
const docs = (template as { documents: TemplateDoc[] }).documents;

const SEEDED = ['/tutorial/radar', '/tutorial/heatmap', '/org/radar', '/org/heatmap'];

describe('workspace template seeds radar + heatmap recipe files', () => {
  for (const path of SEEDED) {
    it(`carries ${path} as a valid viz recipe`, () => {
      const doc = docs.find((d) => d.path === path);
      expect(doc, `${path} missing from workspace-template.json`).toBeDefined();
      expect(doc!.type).toBe('viz');
      expect(validateFileState({ type: 'viz', content: doc!.content })).toBeNull();
    });
  }

  it('radar materializes as native vega and parses (fold-only: single or multi values)', () => {
    const radar = docs.find((d) => d.path === '/tutorial/radar')!.content as VizRecipeContent;
    expect(radar.engine).toBe('vega');
    for (const values of [['spend', 'budget'], 'spend'] as const) {
      const res = materializeFileRecipe(radar, { metric: 'channel', values: values as never }, null, [
        { name: 'channel', kind: 'nominal' },
        { name: 'spend', kind: 'quantitative' },
        { name: 'budget', kind: 'quantitative' },
      ]);
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.engine).toBe('vega');
      // The substituted spec must be a parseable native-Vega spec with the
      // metric interpolated into the fold/aggregate/scale/expression sites.
      expect(JSON.stringify(res.spec)).toContain("datum['channel']");
      expect(() => parseVega(res.spec as never, undefined, { ast: true })).not.toThrow();
      const validated = validateVizEnvelope(
        { version: 2, source: { kind: 'vega', grammar: VIZ_GRAMMAR_VEGA, spec: res.spec, assets: null, detachedFrom: null } },
        undefined,
      );
      expect(validated.ok).toBe(true);
    }
  });

  it('heatmap materializes as vega-lite and RENDERS to SVG with sample rows', async () => {
    const heatmap = docs.find((d) => d.path === '/tutorial/heatmap')!.content as VizRecipeContent;
    expect(heatmap.engine).toBe('vega-lite');
    const sample = sampleDataForRecipe(heatmap);
    const res = materializeFileRecipe(heatmap, sample.bindings, null, sample.columns);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const validated = validateVizEnvelope(
      { version: 2, source: { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec: res.spec, detachedFrom: null } },
      sample.columns,
    );
    expect(validated.ok).toBe(true);
    const svg = await renderVegaLiteToSvg(res.spec, sample.rows, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('rect'); // the heatmap cells actually drew
  });

  it('tutorial and org seeds are identical recipes (one definition, two roots)', () => {
    for (const name of ['radar', 'heatmap']) {
      const tut = docs.find((d) => d.path === `/tutorial/${name}`)!.content;
      const org = docs.find((d) => d.path === `/org/${name}`)!.content;
      expect(tut).toEqual(org);
    }
  });
});
