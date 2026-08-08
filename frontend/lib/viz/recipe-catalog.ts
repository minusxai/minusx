/**
 * The READ-ONLY recipe catalog: the two tiers of chart recipes that ship with
 * the app, projected as recipe CONTENT so the Templates page can show them.
 *
 * These are app vocabulary, not documents. They are deliberately NOT files: a
 * folder in the tree implies a context, an owner, edit/move/delete and a place
 * in recipe resolution, and none of that is true of code. The file system is
 * where a workspace OVERRIDES or EXTENDS this vocabulary — create a `.viz` file
 * of the same name in a folder and the normal shadowing rules apply.
 *
 *  - **Built-in file recipes** (the `TEMPLATE_DIR` registry) are already
 *    `VizRecipeContent`; they project verbatim.
 *  - **Shipped code recipes** (`VIZ_TEMPLATES`, `minusx/…@1`) are functions, not
 *    templates. They are projected by calling `build()` with each slot bound to
 *    its own `{{slot}}` TOKEN, so the spec that comes back is a genuine recipe
 *    template rather than a picture of one — which is what makes "copy to my
 *    workspace" produce a working, editable `.viz` file instead of a dead end.
 *    Not every builder survives that: one embeds a multi slot inside a Vega
 *    expression string, another upper-cases the bound name for a label, and a
 *    token cannot come through either intact. Those are re-projected with
 *    LITERAL slot names and marked `copyable: false` — still fully viewable,
 *    honestly not a template. Which recipes fall in which group is DERIVED by
 *    materializing the projection, never hardcoded, so a builder change moves a
 *    recipe between groups by itself.
 *
 * These files are VIRTUAL: they exist in no table, carry ids from a reserved
 * block, and every write path rejects them. Resolution never sees them either —
 * built-ins already resolve through `resolveVizRecipes` and shipped ids through
 * the code registry, so projecting them here adds a viewing surface and nothing
 * else.
 */
import { getBuiltinVizOrigin, getBuiltinVizRecipes } from './builtin-recipes';
import { materializeFileRecipe, sampleDataForRecipe } from './recipe-file';
import { VIZ_TEMPLATES } from './viz-templates';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';
import type { TemplateOrigin } from '@/lib/templates/types';

/**
 * A shipped recipe's REQUIRED slots. An optional slot (radar's `series`) is
 * omitted from the projection entirely: `materializeFileRecipe` has no optional
 * path — every declared slot must be bound — so carrying one through would
 * force the preview to bind it, and a recipe whose shape CHANGES when the
 * optional slot is present then renders its other shape (radar collapses to a
 * point). Projecting the required slots alone shows the recipe's headline form.
 */
function requiredSlots(template: (typeof VIZ_TEMPLATES)[string]) {
  return template.bindings.filter((b) => !b.optional);
}

/** A shipped code recipe's slot bound to its own token, so `build()` emits a template. */
function tokenBindings(template: (typeof VIZ_TEMPLATES)[string]): Record<string, string | string[]> {
  const bound: Record<string, string | string[]> = {};
  for (const slot of requiredSlots(template)) {
    bound[slot.name] = slot.multi ? [`{{${slot.name}}}`] : `{{${slot.name}}}`;
  }
  return bound;
}

/**
 * Bindings for the literal fallback: the exact column names the recipe VIEWER's
 * sample data will carry (`sampleDataForRecipe` names them after the slots, and
 * splits a multi slot into `<slot>_a`/`<slot>_b`). Binding the slot name itself
 * would reference a column the sample never has, and the preview renders NaN.
 */
function sampleBindings(template: (typeof VIZ_TEMPLATES)[string], base: Omit<VizRecipeContent, 'template'>): Record<string, string | string[]> {
  void template;
  return sampleDataForRecipe({ ...base, template: {} } as VizRecipeContent).bindings;
}

/** Sample columns matching every slot, used only to prove a projection materializes. */
function probeBindings(content: VizRecipeContent): Record<string, string | string[]> {
  const bound: Record<string, string | string[]> = {};
  for (const slot of content.bindings) bound[slot.name] = slot.multi ? ['__probe'] : '__probe';
  return bound;
}

export interface ShippedRecipeProjection {
  content: VizRecipeContent;
  /** True when the projected template is a real recipe (tokens survived `build()`). */
  copyable: boolean;
  /**
   * The recipe's named boundary/lookup datasets (`{localName: assetId}`), for the
   * geo recipes. `VizRecipeContent` has no assets field — a workspace recipe is
   * inert data — so these ride the virtual file's `meta` and are used ONLY to
   * draw the preview. Without them a map recipe previews as an empty card.
   */
  assets?: Record<string, string>;
}

/**
 * Project a shipped code recipe as recipe-file content. Returns null only when
 * the builder throws outright — otherwise the result is always viewable, with
 * `copyable` recording whether it is also a usable template.
 */
export function shippedRecipeAsContent(id: string): ShippedRecipeProjection | null {
  const template = VIZ_TEMPLATES[id];
  if (!template) return null;
  const bindings = requiredSlots(template).map((b) => ({
    name: b.name,
    label: b.label,
    accepts: [...b.accepts],
    ...(b.multi ? { multi: true } : {}),
  }));
  const base = {
    description: SHIPPED_RECIPE_DESCRIPTIONS[id] ?? `Shipped ${template.vizType} recipe`,
    engine: template.engine,
    bindings,
  };

  const build = (bound: Record<string, string | string[]>): VizRecipeContent | null => {
    try {
      return { ...base, template: template.build(bound) } as VizRecipeContent;
    } catch {
      return null;
    }
  };

  const previewAssets = (bound: Record<string, string | string[]>): Record<string, string> | undefined => {
    try {
      const declared = template.assets?.(bound);
      return declared && Object.keys(declared).length > 0 ? declared : undefined;
    } catch {
      return undefined;
    }
  };

  // Prefer the token projection, but only if it really is a template: every slot
  // still tokenized AND the whole thing materializes.
  const tokenized = build(tokenBindings(template));
  if (tokenized) {
    const serialized = JSON.stringify(tokenized.template);
    const intact = bindings.every((b) => serialized.includes(`{{${b.name}}}`));
    if (intact && materializeFileRecipe(tokenized, probeBindings(tokenized)).ok) {
      // Asset ids never depend on the bound COLUMNS (they come from a param or a
      // fixed default), so the sample bindings resolve the same map.
      return { content: tokenized, copyable: true, assets: previewAssets(sampleBindings(template, base)) };
    }
  }
  const sample = sampleBindings(template, base);
  const literal = build(sample);
  return literal ? { content: literal, copyable: false, assets: previewAssets(sample) } : null;
}

/**
 * One-line descriptions for the shipped recipes. They live here rather than on
 * `VizTemplate` because they are a VIEWING concern — the render path never reads
 * them, and the agent gets its own wording from the prompt skill.
 */
const SHIPPED_RECIPE_DESCRIPTIONS: Record<string, string> = {
  'minusx/funnel@1': 'Funnel: one tapered band per stage, widths proportional to value',
  'minusx/waterfall@1': 'Waterfall: running total with per-step rise/fall bars',
  'minusx/radar@1': 'Radar: metrics on angular spokes, one closed polygon per value column',
  'minusx/trend@1': 'Trend: a KPI number with its sparkline and period-over-period delta',
  'minusx/single-value@1': 'Single value: one big number with optional label and formatting',
  'minusx/combo@1': 'Combo: bars and a line on a shared x axis, dual y axes',
  'minusx/choropleth@1': 'Choropleth: regions shaded by value over a boundary map',
  'minusx/point-map@1': 'Point map: latitude/longitude points on an interactive basemap',
};

/**
 * Preview data for recipes whose slots carry REAL-WORLD meaning that the generic
 * sample cannot invent: a latitude of 820 is not a place, and "North" is not a
 * US state, so both map recipes otherwise preview as a smear or a blank
 * outline. Bindings use the slot names, matching what `sampleDataForRecipe`
 * would produce, so the projected template resolves either way.
 */
export interface PreviewSample {
  bindings: Record<string, string | string[]>;
  columns: Array<{ name: string; kind: 'nominal' | 'quantitative' | 'temporal' }>;
  rows: Array<Record<string, unknown>>;
}

const US_CITIES: Array<[string, number, number, number]> = [
  ['California', 36.78, -119.42, 820],
  ['Texas', 31.97, -99.90, 640],
  ['Florida', 27.66, -81.52, 560],
  ['New York', 42.17, -74.95, 470],
  ['Illinois', 40.63, -89.40, 390],
  ['Washington', 47.75, -120.74, 310],
];

const RADAR_METRICS = ['Speed', 'Power', 'Range', 'Comfort', 'Safety', 'Value'];

const PREVIEW_SAMPLES: Record<string, PreviewSample> = {
  // Named metrics beat the generic region labels on a radar's spokes, and two
  // value columns show the recipe's headline shape: one polygon per column.
  'minusx/radar@1': {
    bindings: { metric: 'metric', value: ['value_a', 'value_b'] },
    columns: [
      { name: 'metric', kind: 'nominal' },
      { name: 'value_a', kind: 'quantitative' },
      { name: 'value_b', kind: 'quantitative' },
    ],
    rows: RADAR_METRICS.map((metric, i) => ({
      metric,
      value_a: [82, 64, 56, 47, 39, 71][i],
      value_b: [58, 77, 40, 66, 52, 35][i],
    })),
  },
  'minusx/choropleth@1': {
    bindings: { region: 'region', value: 'value' },
    columns: [{ name: 'region', kind: 'nominal' }, { name: 'value', kind: 'quantitative' }],
    rows: US_CITIES.map(([region, , , value]) => ({ region, value })),
  },
  'minusx/point-map@1': {
    // Real coordinates: latitude 820 is not a place, and the generic sample has
    // no way to know that. Only the required slots — the optional end
    // coordinates would turn the points into flow lines.
    bindings: { lat: 'lat', lng: 'lng' },
    columns: [{ name: 'lat', kind: 'quantitative' }, { name: 'lng', kind: 'quantitative' }],
    rows: US_CITIES.map(([, lat, lng]) => ({ lat, lng })),
  },
};

/** Which tier a catalog entry came from — the viewer labels them differently. */
export type CatalogTier = 'builtin' | 'shipped';

export interface CatalogEntry {
  /** The name a workspace recipe would use to shadow this one. */
  name: string;
  tier: CatalogTier;
  /** The shipped registry id, for a `shipped` entry — what a chart would reference. */
  recipeId?: string;
  /** For a file-tier entry: the app's own templates, or this deployment's. */
  origin?: TemplateOrigin;
  /** Whether this entry's template can be copied into an editable workspace recipe. */
  copyable: boolean;
  /** Named boundary datasets the PREVIEW needs (geo recipes only). */
  assets?: Record<string, string>;
  /** Hand-written preview data, when the generic sample would be nonsense. */
  previewSample?: PreviewSample;
  content: VizRecipeContent;
}

/**
 * Every catalog entry, in code order. Built-ins first (they are copyable,
 * shadowable vocabulary), then the shipped recipes.
 */
export function catalogEntries(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const [name, content] of Object.entries(getBuiltinVizRecipes())) {
    entries.push({ name, tier: 'builtin', origin: getBuiltinVizOrigin(name), copyable: true, content });
  }
  for (const id of Object.keys(VIZ_TEMPLATES)) {
    const projected = shippedRecipeAsContent(id);
    if (!projected) continue;
    const name = id.replace(/^minusx\//, '').replace(/@\d+$/, '');
    entries.push({
      name, tier: 'shipped', recipeId: id,
      copyable: projected.copyable, assets: projected.assets,
      previewSample: PREVIEW_SAMPLES[id], content: projected.content,
    });
  }
  return entries;
}
