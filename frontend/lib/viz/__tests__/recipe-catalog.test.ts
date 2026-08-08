/**
 * The read-only recipe catalog. The load-bearing claim is the shipped-recipe
 * projection: `build()` is called with each slot bound to its own `{{slot}}`
 * token, so what comes back must be a REAL recipe template — one that
 * materializes to a valid spec when a user copies it into their workspace and
 * binds real columns. A builder that cannot survive that round-trip has to fail
 * here, not in someone's workspace.
 */
import { describe, it, expect } from 'vitest';
import {
  CATALOG_VIZ_ID_BASE,
  catalogEntries,
  catalogVizFileById,
  catalogVizFiles,
  isCatalogVizId,
  shippedRecipeAsContent,
} from '@/lib/viz/recipe-catalog';
import { BUILTIN_VIZ_RECIPES } from '@/lib/viz/builtin-recipes';
import { VIZ_TEMPLATES } from '@/lib/viz/viz-templates';
import { materializeFileRecipe, sampleDataForRecipe } from '@/lib/viz/recipe-file';
import type { VizResultColumn } from '@/lib/viz/types';

/** A column of each kind, so any slot's `accepts` can be satisfied. */
const COLUMNS: VizResultColumn[] = [
  { name: 'label', kind: 'nominal' },
  { name: 'when', kind: 'temporal' },
  { name: 'amount', kind: 'quantitative' },
  { name: 'amount2', kind: 'quantitative' },
];

const bindAll = (content: { bindings: ReadonlyArray<{ name: string; accepts: readonly string[]; multi?: boolean }> }) => {
  const bound: Record<string, string | string[]> = {};
  for (const slot of content.bindings) {
    const col = COLUMNS.find((c) => slot.accepts.includes(c.kind)) ?? COLUMNS[0];
    bound[slot.name] = slot.multi ? [col.name] : col.name;
  }
  return bound;
};

describe('recipe catalog', () => {
  it('covers every built-in and every shipped recipe', () => {
    const entries = catalogEntries();
    const builtins = entries.filter((e) => e.tier === 'builtin').map((e) => e.name);
    const shipped = entries.filter((e) => e.tier === 'shipped').map((e) => e.recipeId);
    expect(builtins).toEqual(Object.keys(BUILTIN_VIZ_RECIPES));
    expect(shipped).toEqual(Object.keys(VIZ_TEMPLATES));
  });

  it('projects a built-in verbatim', () => {
    const bullet = catalogEntries().find((e) => e.name === 'bullet')!;
    expect(bullet.content).toBe(BUILTIN_VIZ_RECIPES.bullet);
  });

  it.each(Object.keys(VIZ_TEMPLATES))('%s projects to viewable recipe content', (id) => {
    const projected = shippedRecipeAsContent(id);
    expect(projected, `${id} produced nothing`).not.toBeNull();
    const { content } = projected!;
    // The REQUIRED slot declarations survive the projection, whichever way it
    // was built; optional slots are deliberately dropped (materialization has no
    // optional path, and binding one changes some recipes' shape).
    expect(content.bindings.map((b) => b.name))
      .toEqual(VIZ_TEMPLATES[id].bindings.filter((b) => !b.optional).map((b) => b.name));
    expect(content.bindings.every((b) => !('optional' in b))).toBe(true);
    expect(content.engine).toBe(VIZ_TEMPLATES[id].engine);
    expect(content.description).toBeTruthy();
    expect(Object.keys(content.template).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(VIZ_TEMPLATES))(
    '%s marked copyable IS a working template; marked not, it is honestly literal',
    (id) => {
      const { content, copyable } = shippedRecipeAsContent(id)!;
      const serialized = JSON.stringify(content.template);
      if (copyable) {
        // Every slot is a live token, and binding real columns produces a real spec —
        // so "copy to my workspace" yields a recipe that actually works.
        for (const slot of content.bindings) {
          expect(serialized, `${id} lost the {{${slot.name}}} token`).toContain(`{{${slot.name}}}`);
        }
        const materialized = materializeFileRecipe(content, bindAll(content), null, COLUMNS);
        expect(materialized.ok, materialized.ok ? '' : `${id}: ${materialized.error}`).toBe(true);
      } else {
        // The fallback is a generated spec — never a half-tokenized template,
        // which would look copyable and then fail on bind…
        expect(serialized).not.toContain('{{');
        // …and it must bind the columns the VIEWER's sample data actually has,
        // or the preview renders NaN (a multi slot's sample is `<slot>_a`/`_b`,
        // never the bare slot name).
        const sample = sampleDataForRecipe(content);
        for (const col of sample.columns) expect(serialized).toContain(col.name);
      }
    },
  );

  it('records which shipped recipes cannot be projected as templates', () => {
    // These builders manipulate the bound name as a STRING — a multi slot
    // embedded in a Vega expression, an upper-cased label — which a token
    // cannot survive, so they project as a generated spec instead.
    const notCopyable = catalogEntries().filter((e) => e.tier === 'shipped' && !e.copyable).map((e) => e.recipeId);
    expect(notCopyable).toEqual(['minusx/radar@1', 'minusx/trend@1', 'minusx/single-value@1']);
  });

  it('every hand-written preview sample binds exactly the recipe it is for', () => {
    // A sample missing one slot renders "missing binding: <slot>" in the preview
    // card instead of the chart — which is how the point map shipped with five
    // of its six slots the first time.
    const withSample = catalogEntries().filter((e) => e.previewSample);
    expect(withSample.length).toBeGreaterThan(0);
    for (const entry of withSample) {
      const declared = entry.content.bindings.map((b) => b.name).sort();
      expect(Object.keys(entry.previewSample!.bindings).sort(), entry.name).toEqual(declared);
      // Every bound column must exist in the sample's own columns AND rows.
      const columns = entry.previewSample!.columns.map((c) => c.name);
      for (const bound of Object.values(entry.previewSample!.bindings)) {
        for (const col of Array.isArray(bound) ? bound : [bound]) {
          expect(columns, `${entry.name}: ${col}`).toContain(col);
          expect(Object.keys(entry.previewSample!.rows[0]), `${entry.name}: ${col}`).toContain(col);
        }
      }
      // …and the recipe must actually materialize with them.
      const materialized = materializeFileRecipe(entry.content, entry.previewSample!.bindings, null,
        entry.previewSample!.columns);
      expect(materialized.ok, materialized.ok ? '' : `${entry.name}: ${materialized.error}`).toBe(true);
    }
  });

  it('gives every entry a stable id inside the reserved block', () => {
    const ids = catalogEntries().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isCatalogVizId)).toBe(true);
    expect(ids.every((id) => id >= CATALOG_VIZ_ID_BASE)).toBe(true);
    // A real workspace id must never be mistaken for a catalog one.
    expect(isCatalogVizId(1)).toBe(false);
    expect(isCatalogVizId(1_031)).toBe(false);
  });

  it('projects virtual viz files into the mode-scoped visualizations folder, marked read-only', () => {
    const files = catalogVizFiles('tutorial');
    expect(files.every((f) => f.type === 'viz')).toBe(true);
    expect(files.every((f) => f.path.startsWith('/tutorial/visualizations/'))).toBe(true);
    expect(files.every((f) => (f.meta as { readOnly?: boolean }).readOnly === true)).toBe(true);
    // Same catalog, other mode → same ids, mode-scoped paths (never cross-mode).
    const org = catalogVizFiles('org');
    expect(org.map((f) => f.id)).toEqual(files.map((f) => f.id));
    expect(org.every((f) => f.path.startsWith('/org/visualizations/'))).toBe(true);
  });

  it('resolves a catalog file by id and declines a real id', () => {
    const first = catalogVizFiles('org')[0];
    expect(catalogVizFileById(first.id, 'org')).toMatchObject({ id: first.id, name: first.name });
    expect(catalogVizFileById(42, 'org')).toBeNull();
  });
});
