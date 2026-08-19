/**
 * Radar and heatmap ship as BUILT-IN recipe files on disk (`templates/viz/`),
 * loaded into the built-in registry at boot like every other app template.
 *
 * They were once seeded into the workspace template instead, which made them
 * reachable only in workspaces created AFTER that build — an existing
 * deployment upgrading into this feature lost both from the chart-type picker
 * and gained nothing back, because seeding runs once at registration and there
 * is no backfill. Shipping them on disk is what makes them present in every
 * workspace, old and new, with no migration.
 *
 * These tests pin: they are on disk, they resolve from ANY folder, they still
 * materialize and RENDER, and they are shipped EXACTLY ONCE — the workspace
 * template must not carry a second copy to drift against. The shipped
 * `minusx/radar@1` registry entry stays for saved charts (live references must
 * not break); only the offering moved to files.
 */
import { describe, it, expect } from 'vitest';
import template from '@/lib/database/workspace-template.json';
import { materializeFileRecipe, sampleDataForRecipe, type VizRecipeContent } from '@/lib/viz/recipe-file';
import { validateFileState } from '@/lib/validation/content-validators';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { renderVegaLiteToSvg } from '@/lib/viz/render-vega';
import { VIZ_GRAMMAR_VEGA, VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';
import { parse as parseVega } from 'vega';
import { getBuiltinVizRecipes, getBuiltinVizOrigin } from '@/lib/viz/builtin-recipes';
import { resolveVizRecipes } from '@/lib/viz/recipe-resolve';
import { SUPERSEDED_BY_APP_TEMPLATE } from '@/lib/viz/recipe-catalog';
import { VIZ_TEMPLATES } from '@/lib/viz/viz-templates';
import { appTemplateDir } from '@/lib/templates/registry.server';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

type TemplateDoc = { path: string; type: string; content: unknown };
const docs = (template as { documents: TemplateDoc[] }).documents;

// The test setup boots the template registry, so the built-in set here is
// exactly what a deployment loads from `templates/viz/` at boot.
const builtins = () => getBuiltinVizRecipes();

describe('radar + heatmap ship as built-in recipe files', () => {
  for (const name of ['radar', 'heatmap']) {
    it(`ships ${name} on disk as a valid built-in recipe`, () => {
      const content = builtins()[name];
      expect(content, `${name} missing from templates/viz — an upgraded deployment would lose it`).toBeDefined();
      expect(getBuiltinVizOrigin(name)).toBe('builtin');
      expect(validateFileState({ type: 'viz', content })).toBeNull();
    });

    it(`resolves ${name} from every folder, in any workspace`, () => {
      // No workspace files at all — the case of a deployment that existed
      // before this feature and was never re-seeded.
      for (const folder of ['/', '/org', '/tutorial', '/org/team/deep/nested']) {
        const resolved = resolveVizRecipes([], folder).get(name);
        expect(resolved, `${name} should resolve from ${folder}`).toBeDefined();
        expect(resolved!.source).toBe('builtin');
      }
    });
  }

  it('pins SUPERSEDED_BY_APP_TEMPLATE against what the app actually ships on disk', () => {
    // The catalog hides a code recipe when the app ships a template file of the
    // same name. That list is written by hand; this is what stops it drifting
    // when a template is added or removed from `templates/viz/`.
    const onDisk = readdirSync(join(appTemplateDir(), 'viz'))
      .filter((f) => f.endsWith('.viz'))
      .map((f) => basename(f, '.viz'));
    const collides = Object.keys(VIZ_TEMPLATES).filter((id) =>
      onDisk.includes(id.replace(/^minusx\//, '').replace(/@\d+$/, '')),
    );
    expect([...SUPERSEDED_BY_APP_TEMPLATE].sort()).toEqual(collides.sort());
  });

  it('is the ONLY copy — the workspace template seeds no viz files', () => {
    // A seeded `/org/<name>` file would shadow the built-in by name, so new
    // workspaces would silently keep an old copy after the disk recipe changed.
    expect(docs.filter((d) => d.type === 'viz').map((d) => d.path)).toEqual([]);
  });

  it('radar materializes as native vega and parses (fold-only: single or multi values)', () => {
    const radar = builtins().radar as VizRecipeContent;
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
    const heatmap = builtins().heatmap as VizRecipeContent;
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
});
