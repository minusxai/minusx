/**
 * V1 → V2 converter (Visualization Arch V2 §21, item 1 — the retirement-track keystone).
 *
 * A PURE function that maps a legacy ECharts-era `VizSettings` to a V2 `VizEnvelope`.
 * It is the bridge that lets every existing question render through `<VegaChart>` / the
 * V2 DOM tier with zero deletions: any question with no `viz` envelope is rendered
 * THROUGH this converter (the runtime fallback), and the backfill migration writes its
 * output onto every question that still lacks a `viz`.
 *
 * Mapping (lossless against the shipped recipes — no new recipe is a prerequisite):
 *   table                                   → { kind: 'table' }  (DOM tier)
 *   pivot                                   → { kind: 'pivot', config }  (DOM tier)
 *   bar | line | area | scatter | row | pie → { kind: 'vega-lite' }  (cartesian / arc)
 *   funnel | waterfall | radar | trend      → the shipped `minusx/*` recipes
 *     | combo | single_value
 *   choropleth                              → `minusx/choropleth@1`
 *   point_map                               → `minusx/point-map@1`
 *   geo (dispatch on geoConfig.subType):
 *     choropleth → `minusx/choropleth@1`
 *     points     → `minusx/point-map@1` (size = value, color = colorCol)
 *     lines      → `minusx/point-map@1` flows (lat2/lng2)
 *     heatmap    → `minusx/point-map@1` with size = value  (density folds into sized
 *                  bubbles — decided 2026-07-14; no separate density recipe to migrate)
 *
 * Styling carries over: columnFormats/conditionalFormats flow through to the sources
 * that carry them (table/pivot/recipe), and cartesian charts map styleConfig (stacked,
 * colors, opacity, markerSize), axisConfig (yScale/yMin/yMax/yTitle), and annotations
 * onto the same spec shapes the V2 panel's editors write (see applyLegacyStyle).
 * Remaining gaps, deferred with the ECharts retirement: dualAxis on non-combo types,
 * showDataLabels, x-axis scale/bounds, and style knobs on recipe types.
 */
import type { VizSettings as AtlasVizSettings, VizEnvelope, ColumnFormatConfig } from '@/lib/validation/atlas-schemas';
import { VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';
import type { VizColumnKind, VizResultColumn } from './types';
import { addYField, setChannelField, setVizType, isEnvelopeImageViz, setStacked, setYLogScale, setYBounds, addReferenceLine, type SpecVizType } from './encoding-edit';
import { getEffectiveColorPalette } from '@/lib/chart/echarts-theme';
import { toVizColumns } from './query-data';

/**
 * `choropleth`/`point_map` join the authorable VIZ_TYPES union only alongside the
 * agent-skill documentation for them (the bundled-prompts test binds the two); the
 * converter accepts them ahead of that so the geo recipes are exercised end-to-end.
 * Collapse back to the plain atlas `VizSettings` once the union carries both.
 */
export type ConvertibleVizSettings = Omit<AtlasVizSettings, 'type'> & {
  type: AtlasVizSettings['type'] | 'choropleth' | 'point_map';
};
type VizSettings = ConvertibleVizSettings;

const KIND_TO_VL_TYPE: Record<VizColumnKind, string> = {
  quantitative: 'quantitative',
  temporal: 'temporal',
  nominal: 'nominal',
  boolean: 'nominal',
  unknown: 'nominal',
};

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Build a source object into a version-2 envelope. */
const wrap = (source: Record<string, unknown>): VizEnvelope =>
  ({ version: 2, source } as unknown as VizEnvelope);

/** Recipe envelope: null-out an empty params bag; carry columnFormats through. */
const recipeEnvelope = (
  recipe: string,
  bindings: Record<string, string | string[]>,
  params: Record<string, unknown> | null,
  columnFormats: Record<string, ColumnFormatConfig> | null,
): VizEnvelope =>
  wrap({
    kind: 'recipe',
    recipe,
    bindings,
    params: params && Object.keys(params).length > 0 ? params : null,
    columnFormats: columnFormats ?? null,
  });

/** Drop null/undefined/empty entries; null when nothing survives. */
const compact = (obj: Record<string, unknown>): Record<string, unknown> | null => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && v !== '') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
};

// ── Cartesian / arc (bar, line, area, scatter, row, pie) ────────────────────────────
//
// A plain SUM-aggregated bar is the canonical base (matching setEnvelopeVizType's
// table→chart reconstruction), then setVizType morphs it to the target — so the
// converter's output is byte-identical to what the icon selector produces.
function cartesianEnvelope(
  vizSettings: VizSettings,
  columns: VizResultColumn[] | undefined,
  target: SpecVizType,
): VizEnvelope {
  const xCols = vizSettings.xCols ?? [];
  const yCols = vizSettings.yCols ?? [];
  const x = nonEmpty(xCols[0]) ? xCols[0] : null;
  const series = nonEmpty(xCols[1]) ? xCols[1] : null;
  const y0 = nonEmpty(yCols[0]) ? yCols[0] : null;
  const kindOf = (name: string): VizColumnKind => columns?.find(c => c.name === name)?.kind ?? 'nominal';

  let env = wrap({
    kind: 'vega-lite',
    grammar: VIZ_GRAMMAR_VEGA_LITE,
    spec: {
      mark: { type: 'bar' },
      encoding: {
        ...(x ? { x: { field: x, type: KIND_TO_VL_TYPE[kindOf(x)] } } : {}),
        ...(y0 ? { y: { field: y0, type: 'quantitative', aggregate: 'sum' } } : {}),
      },
    },
  });

  // Extra measures fold onto the value axis (color becomes the measure key).
  for (const measure of yCols.slice(1).filter(nonEmpty)) {
    env = addYField(env, { name: measure, kind: 'quantitative' });
  }
  // A second grouping column is the series split — but only when a single measure is
  // bound (a multi-measure fold already owns the color channel).
  if (series && yCols.filter(nonEmpty).length <= 1) {
    env = setChannelField(env, 'color', { name: series, kind: kindOf(series) });
  }

  return target === 'bar' ? env : setVizType(env, target);
}

// ── Geo (choropleth / point-map recipes) ────────────────────────────────────────────
//
// Both top-level geo types (`choropleth`, `point_map`) and the umbrella `geo` type
// (dispatched on geoConfig.subType) resolve to the two shipped geo recipes.
function geoEnvelope(vizSettings: VizSettings): VizEnvelope {
  const g = (vizSettings.geoConfig ?? {}) as Record<string, unknown>;
  const xCols = vizSettings.xCols ?? [];
  const yCols = vizSettings.yCols ?? [];
  const str = (v: unknown): string | null => (nonEmpty(v) ? v : null);
  const columnFormats = vizSettings.columnFormats ?? null;

  const subType =
    vizSettings.type === 'choropleth' ? 'choropleth'
    : vizSettings.type === 'point_map' ? 'points'
    : (g.subType as string | undefined) ?? 'points';

  if (subType === 'choropleth') {
    const region = str(g.regionCol) ?? str(xCols[0]);
    const value = str(g.valueCol) ?? str(yCols[0]);
    return recipeEnvelope(
      'minusx/choropleth@1',
      compact({ region, value }) as Record<string, string>,
      compact({ mapName: g.mapName, colorScale: g.colorScale }),
      columnFormats,
    );
  }

  // points / lines / heatmap all resolve to point-map; the bound slots differ.
  const lat = str(g.latCol) ?? str(xCols[0]);
  const lng = str(g.lngCol) ?? str(xCols[1]);
  const bindings: Record<string, unknown> = { lat, lng };
  if (subType === 'lines') {
    bindings.lat2 = str(g.latCol2);
    bindings.lng2 = str(g.lngCol2);
  } else {
    // points + heatmap: the value column sizes the bubbles (density → sized bubbles).
    bindings.size = str(g.valueCol) ?? str(yCols[0]);
    if (subType === 'points') bindings.color = str(g.colorCol);
  }
  const params = compact({
    mapName: g.mapName,
    colorScale: g.colorScale,
    basemap: g.showTiles === true ? 'tiles' : undefined,
    center: Array.isArray(g.pinnedCenter) ? g.pinnedCenter : undefined,
  });
  return recipeEnvelope('minusx/point-map@1', compact(bindings) as Record<string, string>, params, columnFormats);
}

// ── Legacy style carry-over (§21 items 6/9 — the "robust converter") ────────────────
//
// V1 style knobs survive conversion by mapping onto the SAME spec shapes the V2
// panel's surgical editors write — a converted chart both renders styled and stays
// fully editable if it's later upgraded. Value-axis knobs (stacked/log/bounds) and
// annotations skip `row` (its value axis is x — no V2 primitive for that yet) and
// `pie` (no positional axes). Known gaps, deferred with the ECharts retirement:
// dualAxis on non-combo types, showDataLabels, x-axis scale/bounds.
function applyLegacyStyle(envelope: VizEnvelope, vizSettings: VizSettings): VizEnvelope {
  const style = vizSettings.styleConfig;
  const axis = vizSettings.axisConfig;
  const annotations = vizSettings.annotations ?? [];
  if (!style && !axis && annotations.length === 0) return envelope;

  const source = envelope.source as unknown as { kind?: string; spec?: Record<string, unknown> };
  if (source.kind !== 'vega-lite' || source.spec == null) return envelope;

  const type = vizSettings.type;
  const hasValueYAxis = type !== 'row' && type !== 'pie';
  let env = envelope;

  // Mark-level knobs + color overrides mutate the converter-owned unit spec directly
  // (this runs only on cartesianEnvelope's fresh output, before any cloning editor).
  const spec = source.spec;
  const mark: Record<string, unknown> = typeof spec.mark === 'string' ? { type: spec.mark } : { ...((spec.mark as Record<string, unknown>) ?? {}) };
  if (style?.opacity != null) mark.opacity = style.opacity;
  if (style?.markerSize != null) {
    // ECharts symbolSize is a diameter in px; Vega-Lite point size is an AREA in px².
    const area = Math.round(Math.PI * (style.markerSize / 2) ** 2);
    if (type === 'scatter') mark.size = area;
    // On a line mark `size` means stroke width — point size lives on the overlay.
    if (type === 'line') mark.point = { ...(typeof mark.point === 'object' && mark.point != null ? mark.point as Record<string, unknown> : {}), size: area };
  }
  const colors = style?.colors ?? null;
  if (colors && Object.keys(colors).length > 0) {
    // Index-keyed V1 overrides → an effective palette on the scale RANGE (no domain
    // pin, so colors assign in order of appearance — the ECharts index semantics).
    const palette = getEffectiveColorPalette(colors);
    const encoding = (spec.encoding ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const colorDef = encoding.color;
    if (colorDef != null) {
      colorDef.scale = { ...((colorDef.scale as Record<string, unknown>) ?? {}), range: palette };
    } else if ('0' in colors) {
      mark.color = palette[0]; // single measure: no color channel — pin the mark itself
    }
  }
  spec.mark = mark;

  if (axis?.yTitle && hasValueYAxis) {
    const encoding = (spec.encoding ?? {}) as Record<string, Record<string, unknown> | undefined>;
    if (encoding.y != null) encoding.y.axis = { ...((encoding.y.axis as Record<string, unknown>) ?? {}), title: axis.yTitle };
  }

  // Value-axis knobs + annotations via the V2 surgical editors (immutable — they clone).
  if (hasValueYAxis) {
    if (style?.stacked != null && (type === 'bar' || type === 'area')) env = setStacked(env, style.stacked);
    if (axis?.yScale === 'log') env = setYLogScale(env, true);
    if (axis?.yMin != null || axis?.yMax != null) env = setYBounds(env, { min: axis?.yMin ?? undefined, max: axis?.yMax ?? undefined });
    // Annotations LAST — they wrap the unit spec into layers.
    for (const a of annotations) {
      if (a?.x == null || !a.text) continue;
      env = addReferenceLine(env, { axis: 'x', value: a.x, label: a.text });
    }
  }
  return env;
}

/**
 * V1 → V2 render bridge (§21 item 1). On EVERY surface — dashboards, notebook cells,
 * stories, embeds, and the editable question page — a legacy question with no `viz`
 * envelope renders its CHART through `<VegaChart>` via the converter; the question
 * page's Viz panel edits the same converted envelope (the first edit writes a real
 * `viz` onto the content, so the file upgrades on Save). Table/pivot keep their
 * existing DOM renderers. Returns null when no bridge applies — the caller then falls
 * back to the legacy render path.
 */
export function resolveLegacyRenderEnvelope(args: {
  hasVizEnvelope: boolean;
  vizSettings: VizSettings | null | undefined;
  columns: VizResultColumn[];
}): VizEnvelope | null {
  const { hasVizEnvelope, vizSettings, columns } = args;
  if (hasVizEnvelope || !vizSettings) return null;
  if (vizSettings.type === 'table' || vizSettings.type === 'pivot') return null;
  return vizSettingsToEnvelope(vizSettings, columns);
}

/**
 * The chart→IMAGE bridge (§21 item 2 meets item 1): the envelope every image pipeline
 * (Slack, LLM attachments, headless exports) renders from. A V2 `viz` is authoritative
 * (image kinds only — table/pivot are DOM-tier, no chart image); a legacy chart's
 * vizSettings converts through the same converter as the render bridge, with the query
 * result's column kinds so temporal axes survive. Null = nothing to image.
 */
export function resolveImageEnvelope(args: {
  viz?: VizEnvelope | null;
  vizSettings?: VizSettings | null;
  columns?: string[];
  types?: string[];
}): VizEnvelope | null {
  const { viz, vizSettings, columns, types } = args;
  if (viz) return isEnvelopeImageViz(viz) ? viz : null;
  if (!vizSettings || vizSettings.type === 'table' || vizSettings.type === 'pivot') return null;
  const converted = vizSettingsToEnvelope(
    vizSettings,
    columns && types ? toVizColumns(columns, types) : undefined,
  );
  return isEnvelopeImageViz(converted) ? converted : null;
}

export function vizSettingsToEnvelope(
  vizSettings: VizSettings,
  columns?: VizResultColumn[],
): VizEnvelope {
  const { type } = vizSettings;
  const xCols = vizSettings.xCols ?? [];
  const yCols = vizSettings.yCols ?? [];
  const columnFormats = vizSettings.columnFormats ?? null;
  const first = (arr: (string | null)[]): string | null => arr.find(nonEmpty) ?? null;

  switch (type) {
    case 'table':
      return wrap({
        kind: 'table',
        columnFormats,
        conditionalFormats: vizSettings.conditionalFormats ?? null,
        css: null,
      });

    case 'pivot':
      return wrap({
        kind: 'pivot',
        config: vizSettings.pivotConfig ?? { rows: [], columns: [], values: [] },
        columnFormats,
        conditionalFormats: vizSettings.conditionalFormats ?? null,
        css: null,
      });

    case 'bar':
    case 'line':
    case 'area':
    case 'scatter':
    case 'row':
    case 'pie':
      return applyLegacyStyle(cartesianEnvelope(vizSettings, columns, type as SpecVizType), vizSettings);

    case 'funnel':
      return recipeEnvelope('minusx/funnel@1', compact({ stage: first(xCols), value: first(yCols) }) as Record<string, string>, null, columnFormats);

    case 'waterfall':
      return recipeEnvelope('minusx/waterfall@1', compact({ category: first(xCols), value: first(yCols) }) as Record<string, string>, null, columnFormats);

    case 'radar': {
      const measures = yCols.filter(nonEmpty);
      return recipeEnvelope(
        'minusx/radar@1',
        compact({ metric: first(xCols), value: measures.length > 1 ? measures : measures[0] }) as Record<string, string | string[]>,
        null,
        columnFormats,
      );
    }

    case 'trend': {
      const measures = yCols.filter(nonEmpty);
      return recipeEnvelope(
        'minusx/trend@1',
        compact({ date: first(xCols), value: measures.length > 1 ? measures : measures[0] }) as Record<string, string | string[]>,
        compact({ compareMode: vizSettings.trendConfig?.compareMode }),
        columnFormats,
      );
    }

    case 'combo': {
      const measures = yCols.filter(nonEmpty);
      return recipeEnvelope(
        'minusx/combo@1',
        compact({ x: first(xCols), bar: measures[0], line: measures[1] ?? measures[0] }) as Record<string, string>,
        null,
        columnFormats,
      );
    }

    case 'single_value': {
      const cfg = vizSettings.singleValueConfig ?? {};
      return recipeEnvelope(
        'minusx/single-value@1',
        compact({ value: first(yCols) ?? first(xCols) }) as Record<string, string>,
        compact({ label: cfg.label, valueColor: cfg.valueColor, align: cfg.align }),
        columnFormats,
      );
    }

    case 'choropleth':
    case 'point_map':
    case 'geo':
      return geoEnvelope(vizSettings);

    default: {
      // Exhaustiveness guard — any new VizSettings.type must extend this switch.
      const _never: never = type;
      void _never;
      return wrap({ kind: 'table', columnFormats, conditionalFormats: null, css: null });
    }
  }
}
