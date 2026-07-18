/**
 * The single Vega render pipeline (RFC §3): prepare → theme config → vega-lite compile
 * → vega parse (ast) → View (CSP-safe expression interpreter) → named data injection.
 *
 * Used by the browser component (<VegaChart>, renderer 'svg' into a container) and
 * headlessly (renderer 'none' → toSVG) for server previews, exports, and the
 * chart→LLM image pipeline. One pipeline, no divergence.
 *
 * Security (RFC §12): specs are parsed with {ast: true} and evaluated with
 * vega-interpreter — no generated JavaScript functions, CSP-safe everywhere.
 * External data can't reach this layer (the validator rejects data.url/values,
 * and the only dataset bound is the query result under the reserved name).
 * TODO(RFC §12): tighten the Vega event config (deny window/timer/selector
 * sources) when interactions land — compiled VL output uses none of them today.
 */
import { compile } from 'vega-lite';
import type { TopLevelSpec } from 'vega-lite';
import { parse, View } from 'vega';
import type { Spec as VegaSpec } from 'vega';
import { expressionInterpreter } from 'vega-interpreter';
import { Handler as TooltipHandler } from 'vega-tooltip';
import { prepareVegaLiteSpec } from './prepare';
import { annotationSplit } from './encoding-edit';
import { getVegaLiteConfig, getVegaParserConfig, getSurfaceColor } from './theme';
import { materializeRecipe } from './viz-templates';
import { VIZ_DATASET_MAIN } from './types';
import { loadGeoFeatures } from './geo-assets';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

export type ResolvedEnvelopeSpec =
  | { ok: true; spec: Record<string, unknown>; engine: 'vega-lite' | 'vega'; assets?: Record<string, string> }
  | { ok: false; error: string };

/**
 * Resolve an envelope's renderable spec + grammar engine: native sources return their
 * spec, recipe sources materialize from the shipped registry (render-time, never stored).
 * A recipe's declared boundary/lookup `assets` (RFC §9) ride along for the injection step.
 */
export function resolveEnvelopeSpec(envelope: VizEnvelope): ResolvedEnvelopeSpec {
  const source = envelope.source as unknown as Record<string, unknown>;
  if (source.kind === 'recipe') {
    return materializeRecipe(source as unknown as { recipe: string; bindings: Record<string, string> });
  }
  // Detached native-Vega spec (RFC §21.10): render as-is on the vega engine, carrying
  // any named boundary/lookup datasets for injection (geo maps keep working post-detach).
  if (source.kind === 'vega') {
    const assets = source.assets as Record<string, string> | null | undefined;
    return {
      ok: true,
      spec: source.spec as Record<string, unknown>,
      engine: 'vega',
      ...(assets && Object.keys(assets).length > 0 ? { assets } : {}),
    };
  }
  return { ok: true, spec: (source as { spec: Record<string, unknown> }).spec, engine: 'vega-lite' };
}

/**
 * Inject a recipe's named boundary/lookup datasets into a built view (RFC §9/§12).
 * Each `{localName: assetId}` is resolved from the geo registry and bound under its
 * local name alongside `main` — the only path secondary geometry reaches the renderer
 * (there is no network fetch inside the vega runtime). Features are shallow-cloned per
 * view: vega tags each bound tuple with Symbol(vega_id), and the registry caches and
 * shares the feature objects across every chart. `load` is injectable for tests.
 */
export async function injectNamedAssets(
  view: View,
  assets: Record<string, string> | undefined,
  load: (assetId: string) => Promise<import('geojson').Feature[]> = loadGeoFeatures,
): Promise<void> {
  if (!assets) return;
  await Promise.all(Object.entries(assets).map(async ([name, assetId]) => {
    const features = await load(assetId);
    view.data(name, features.map(f => ({ ...f })));
  }));
}

/**
 * Turn a resolved spec into the parsed-vega inputs: VL specs compile (theme embedded
 * in the VL config); native Vega specs go straight to parse with the themed parser
 * config. One divergence point, both tiers themed from the same tokens.
 */
export function toVegaSpec(
  resolved: { spec: Record<string, unknown>; engine: 'vega-lite' | 'vega' },
  mode: 'light' | 'dark',
  options?: CompileVegaLiteOptions,
): { vegaSpec: VegaSpec; parserConfig?: Record<string, unknown> } {
  if (resolved.engine === 'vega') {
    return { vegaSpec: resolved.spec as unknown as VegaSpec, parserConfig: getVegaParserConfig(mode) };
  }
  return { vegaSpec: compileVegaLite(resolved.spec, mode, options) };
}

export interface VegaViewOptions {
  renderer: 'svg' | 'canvas' | 'none';
  /** DOM container (browser only). */
  container?: HTMLElement;
  width?: number;
  height?: number;
  /** Install the styled HTML tooltip handler (browser only; styled in globals.css). */
  tooltipTheme?: 'light' | 'dark';
  /** Vega parser config — used by the native-vega engine (VL bakes theme at compile). */
  parserConfig?: Record<string, unknown>;
}

/**
 * Single-series legend (ECharts parity, matches the radar behavior): a colorless
 * unit chart with a field-bearing y gets a constant color datum named after the
 * measure (its title if set, else the field name) — which renders as a one-entry
 * legend. Render-time only; any author color encoding wins untouched.
 */
export function injectSingleSeriesLegend(prepared: Record<string, unknown>): void {
  const encoding = prepared.encoding as Record<string, Record<string, unknown> | undefined> | undefined;
  if (!encoding || encoding.color != null) return;
  const y = encoding.y;
  if (!y || typeof y !== 'object' || typeof y.field !== 'string') return;
  const label = typeof y.title === 'string' ? y.title : y.field;
  encoding.color = { datum: label };
}

/**
 * Interactive-legend platform default (ECharts parity): clicking a legend entry
 * highlights that series (shift-click for multi-select, click elsewhere to clear).
 * Injected at render time only — never persisted — and only when it's safely additive:
 * a single-view spec with a discrete color field, no author params, no author opacity.
 * Uses the reserved `mx` signal namespace (RFC §13).
 */
function injectLegendToggle(prepared: Record<string, unknown>): void {
  if ('params' in prepared) return;
  // Composite marks (boxplot/errorbar/errorband): VL silently DROPS selection params
  // on them but still compiles the opacity condition, leaving a dangling reference —
  // the runtime throws `Unrecognized signal name: "mx_legend_sel"`.
  const mark = prepared.mark;
  const markType = typeof mark === 'string' ? mark : (mark as { type?: string } | undefined)?.type;
  if (markType === 'boxplot' || markType === 'errorbar' || markType === 'errorband') return;
  const encoding = prepared.encoding as Record<string, Record<string, unknown>> | undefined;
  const color = encoding?.color;
  if (!encoding || !color || typeof color.field !== 'string' || 'opacity' in encoding) return;
  if (color.type != null && color.type !== 'nominal' && color.type !== 'ordinal') return;
  prepared.params = [{
    name: 'mx_legend_sel',
    select: { type: 'point', fields: [color.field] },
    bind: 'legend',
  }];
  encoding.opacity = {
    condition: { param: 'mx_legend_sel', value: 1 },
    value: 0.25,
  };
}

/**
 * Compile a (raw, saved) Vega-Lite spec into a full Vega spec with the MinusX theme.
 * A responsive-by-default autosize is applied at render time only — never persisted
 * into the saved spec (the container owns sizing, RFC §15); explicit spec autosize wins.
 */
/**
 * House heatmap cell layout: rect-mark unit specs get FLUSH bands (padding 0) on
 * their discrete x/y — the visible gap between cells is the theme's constant-pixel
 * surface-colour stroke, NOT band padding, which scales with cell size and looks
 * cavernous on small cross-tabs. Any author-set scale padding on a channel opts out.
 */
export function injectHeatmapCellLayout(prepared: Record<string, unknown>): void {
  const mark = prepared.mark;
  const markType = typeof mark === 'string' ? mark : (mark as { type?: string } | undefined)?.type;
  if (markType !== 'rect') return;
  const encoding = prepared.encoding as Record<string, unknown> | undefined;
  if (!encoding) return;
  for (const channel of ['x', 'y']) {
    const def = encoding[channel];
    if (!def || typeof def !== 'object' || Array.isArray(def)) continue;
    const d = def as Record<string, unknown>;
    if (d.type !== 'nominal' && d.type !== 'ordinal') continue;
    const scale = (d.scale ?? {}) as Record<string, unknown>;
    if ('paddingInner' in scale || 'paddingOuter' in scale || 'padding' in scale) continue;
    d.scale = { ...scale, paddingInner: 0, paddingOuter: 0 };
  }
}

/**
 * Legend wrap planning. The house legend is one centered row of entries;
 * anchored middle, a too-wide row clips on BOTH edges in a narrow
 * container (dashboard tile) and trailing entries disappear entirely.
 *
 * The column count is decided HERE in plain JS, not by a Vega signal: signal
 * expressions on `columns` are evaluated against an unsettled width and the
 * legend layout never re-flows (probed headless: the width signal read 232
 * regardless of the real container). The renderer knows the true container
 * width, the entry labels come from the data, and the house font is mono, so
 * label widths are exact — the resulting CONSTANT is baked in before parse, so
 * the fit-autosize pass sees the final legend height (no post-layout clipping).
 */
// JetBrains Mono advance width is 0.6em at the 11px legend-label size.
const LEGEND_LABEL_CHAR_PX = 6.6;
const LEGEND_LABEL_LIMIT = 220; // theme labelLimit — vega truncates past this
const LEGEND_ENTRY_CHROME_PX = 36; // symbol + label offset + column padding
const LEGEND_AXIS_GUTTER_PX = 0; // y-axis labels + title the legend row can't use
const LEGEND_PADDING_GUTTER_PX = 16; // axis-less charts (pie): view padding only
const LEGEND_MAX_ROWS = 3; // beyond this the legend eats the chart — truncate instead

export interface LegendWrapPlan {
  /** Grid column count baked onto the legend. */
  columns: number;
  /** Explicit entry list when truncated to LEGEND_MAX_ROWS (display order). */
  values?: string[];
  /** Hidden-entry count behind `values` — shown as a "+N more" list entry. */
  moreCount?: number;
}

/**
 * Drop all Vega-Lite legend titles. They repeat what the chart and entry labels
 * already communicate and consume scarce horizontal space. A channel-level
 * `title` still renames tooltips/axes without surfacing as a legend heading.
 */
const LEGEND_CHANNELS = ['color', 'fill', 'stroke', 'opacity', 'shape', 'size', 'strokeDash'] as const;

function suppressLegendTitles(spec: Record<string, unknown>): void {
  const encoding = spec.encoding as Record<string, unknown> | undefined;
  for (const channel of LEGEND_CHANNELS) {
    const def = encoding?.[channel];
    if (!def || typeof def !== 'object' || Array.isArray(def)) continue;
    const d = def as Record<string, unknown>;
    if (typeof d.field !== 'string') continue;
    const legend = d.legend as Record<string, unknown> | null | undefined;
    if (legend === null) continue;
    d.legend = { ...(legend ?? {}), title: null };
  }
  const layers = spec.layer;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      if (layer != null && typeof layer === 'object' && !Array.isArray(layer)) {
        suppressLegendTitles(layer as Record<string, unknown>);
      }
    }
  }
}

/** Whether any (sub)view positions on y — i.e. a left axis gutter exists. */
function hasYField(spec: Record<string, unknown>): boolean {
  const y = (spec.encoding as Record<string, Record<string, unknown>> | undefined)?.y;
  if (y && typeof y === 'object' && 'field' in y) return true;
  const layers = spec.layer;
  return Array.isArray(layers) && layers.some(l =>
    l != null && typeof l === 'object' && !Array.isArray(l) && hasYField(l as Record<string, unknown>));
}

/** The color-channel def of a unit spec, or the first color among layers. */
function findColorDef(spec: Record<string, unknown>): Record<string, unknown> | null {
  const own = (spec.encoding as Record<string, unknown> | undefined)?.color;
  if (own && typeof own === 'object' && !Array.isArray(own)) return own as Record<string, unknown>;
  const layers = spec.layer;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      if (layer && typeof layer === 'object' && !Array.isArray(layer)) {
        const found = findColorDef(layer as Record<string, unknown>);
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Decide the top legend's wrap for `containerWidth`, or null to leave Vega's
 * single-row default (fits, or not ours to touch: authored columns / non-top
 * orient / gradient / no discrete color field). When even the wrapped grid
 * would exceed LEGEND_MAX_ROWS, the plan truncates: the first columns×rows
 * entries (display order) plus a "(+N more)" title suffix — the CHART keeps
 * every series; only the legend elides.
 */
export function computeLegendPlan(
  spec: Record<string, unknown>,
  rows: Record<string, unknown>[],
  containerWidth: number,
): LegendWrapPlan | null {
  const color = findColorDef(spec);
  if (!color || typeof color.field !== 'string') return null;
  if (color.type === 'quantitative' || color.type === 'temporal') return null; // gradient legend
  const legend = color.legend as Record<string, unknown> | null | undefined;
  if (legend === null) return null; // legend disabled
  if (legend && ('columns' in legend || ('orient' in legend && legend.orient !== 'top'))) return null;

  // Entry labels: the color field's distinct values — except under a fold
  // (multi-Y), where the key never appears in the raw rows and the labels are
  // the folded column names from the transform itself.
  const field = color.field;
  let labels: string[] | null = null;
  const transforms = spec.transform;
  if (Array.isArray(transforms)) {
    for (const t of transforms) {
      const fold = (t as Record<string, unknown>)?.fold;
      const as = (t as Record<string, unknown>)?.as;
      if (Array.isArray(fold) && Array.isArray(as) && as[0] === field) {
        labels = fold.map(String);
        break;
      }
    }
  }
  if (!labels) {
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row[field];
      if (v != null) seen.add(String(v));
    }
    labels = [...seen];
  }
  if (labels.length < 2) return null;

  const labelPx = (text: string, charPx: number, limit: number) =>
    Math.min(Math.ceil(text.length * charPx), limit);
  const entryWidths = labels.map(l => labelPx(l, LEGEND_LABEL_CHAR_PX, LEGEND_LABEL_LIMIT) + LEGEND_ENTRY_CHROME_PX);
  const gutter = hasYField(spec) ? LEGEND_AXIS_GUTTER_PX : LEGEND_PADDING_GUTTER_PX;
  const available = Math.max(containerWidth - gutter, 60);

  const singleRow = entryWidths.reduce((a, b) => a + b, 0);
  if (singleRow <= available) return null;
  // Each column is as wide as its widest entry (plan with the max so the
  // estimate can only over-wrap, never overflow).
  const maxEntry = Math.max(...entryWidths);
  const columns = Math.max(1, Math.floor(available / maxEntry));
  if (Math.ceil(labels.length / columns) <= LEGEND_MAX_ROWS) return { columns };
  // Truncate in display order (Vega's default ascending domain sort). The
  // "+N more" sentinel takes the grid's last slot, so it costs one real entry.
  const visible = columns * LEGEND_MAX_ROWS - 1;
  const sorted = [...labels].sort();
  return { columns, values: sorted.slice(0, visible), moreCount: labels.length - visible };
}

/** Bake a wrap plan onto discrete top legends of a COMPILED spec. */
function injectLegendPlan(vegaSpec: Record<string, unknown>, plan: LegendWrapPlan): void {
  const legends = vegaSpec.legends as Record<string, unknown>[] | undefined;
  if (!Array.isArray(legends)) return;
  const scales = (vegaSpec.scales ?? []) as { name?: string; type?: string }[];
  const DISCRETE = ['ordinal', 'band', 'point'];
  for (const legend of legends) {
    if ('columns' in legend) continue; // author opt-out
    if ('orient' in legend && legend.orient !== 'top') continue;
    const scaleName = (['fill', 'stroke', 'shape', 'size', 'opacity'] as const)
      .map(ch => legend[ch]).find(v => typeof v === 'string');
    const scale = scales.find(s => s.name === scaleName);
    if (!scale || !DISCRETE.includes(scale.type ?? '')) continue;
    legend.columns = plan.columns;
    if (plan.values && plan.moreCount) {
      // The "+N more" indicator is a LIST ENTRY: a sentinel value appended to
      // the explicit entry list. It isn't in the scale domain, so its symbol is
      // hidden (opacity 0) and its label muted — a pure text row in the grid.
      const sentinel = `+${plan.moreCount} more`;
      legend.values = [...plan.values, sentinel];
      const isSentinel = `datum.value === '${sentinel}'`;
      legend.encode = {
        symbols: { update: { opacity: [{ test: isSentinel, value: 0 }, { value: 1 }] } },
        labels: { update: { opacity: [{ test: isSentinel, value: 0.55 }, { value: 1 }] } },
        ...(legend.encode as object | undefined ?? {}),
      };
    } else if (plan.values) {
      legend.values = plan.values;
    }
  }
}

/**
 * Adaptive x-axis label angle (house default). Vega-Lite's discrete-axis default
 * is labelAngle -90 — every category chart rendered vertical labels. Like the
 * legend wrap, the angle is planned HERE in plain JS from the actual labels and
 * the true container width (mono font → label widths are exact), then baked in
 * before compile:
 *   0 (horizontal) when the widest label fits its band step,
 *   -45 (slanted) when crowded but the steps still give slant room,
 *   null for ultra-dense axes (≲16px steps, e.g. heatmap week columns) — leave
 *   Vega-Lite's vertical default, the only orientation that survives that density.
 * Authored settings win: an explicit x-axis labelAngle (or axis: null) → null.
 */
const XLABEL_CHAR_PX = 6.6;     // JetBrains Mono advance width at the 11px label size
const XLABEL_PADDING_PX = 10;   // breathing room between neighboring horizontal labels
const XLABEL_MIN_SLANT_STEP_PX = 16; // below this even -45 labels collide
const XLABEL_Y_GUTTER_PX = 55;  // y-axis labels + title the plot area can't use
const XLABEL_SCAN_CAP = 400;    // distinct-label scan bound (dense axes exit via null anyway)

export function computeXLabelAngle(
  spec: Record<string, unknown>,
  rows: Record<string, unknown>[],
  containerWidth: number,
): number | null {
  const unit = annotationSplit(spec)?.unit ?? null;
  if (!unit) return null; // composed spec — not ours to touch
  const x = (unit.encoding as Record<string, Record<string, unknown>> | undefined)?.x;
  if (!x || typeof x.field !== 'string') return null;
  if (x.type !== 'nominal' && x.type !== 'ordinal') return null; // continuous axes are horizontal already
  if (x.axis === null) return null; // axis disabled by the author
  const axis = x.axis as Record<string, unknown> | undefined;
  if (axis && 'labelAngle' in axis) return null; // authored angle wins

  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[x.field];
    if (v != null) seen.add(String(v));
    if (seen.size > XLABEL_SCAN_CAP) break;
  }
  if (seen.size === 0) return null;

  const available = Math.max(containerWidth - (hasYField(unit) ? XLABEL_Y_GUTTER_PX : 0), 60);
  const step = available / seen.size;
  const maxLabelPx = Math.max(...[...seen].map(l => l.length)) * XLABEL_CHAR_PX;
  if (maxLabelPx + XLABEL_PADDING_PX <= step) return 0;
  if (step >= XLABEL_MIN_SLANT_STEP_PX) return -45;
  return null;
}

/** Bake a planned x label angle onto the (unit or annotated-base) x encoding. */
function injectXLabelAngle(prepared: Record<string, unknown>, angle: number): void {
  const unit = annotationSplit(prepared)?.unit ?? null;
  const x = (unit?.encoding as Record<string, Record<string, unknown>> | undefined)?.x;
  if (!x || x.axis === null) return;
  const axis = (x.axis ?? {}) as Record<string, unknown>;
  if ('labelAngle' in axis) return;
  x.axis = { ...axis, labelAngle: angle };
}

export interface CompileVegaLiteOptions {
  /** Planned legend wrap (computeLegendPlan) — null/undefined = single row. */
  legendPlan?: LegendWrapPlan | null;
  /** Planned x label angle (computeXLabelAngle) — null/undefined = VL defaults. */
  xLabelAngle?: number | null;
}

export function compileVegaLite(
  spec: Record<string, unknown>,
  mode: 'light' | 'dark',
  options?: CompileVegaLiteOptions,
): VegaSpec {
  // Ownership boundary: specs arrive from Redux (immer deep-frozen) and vega-lite/vega
  // mutate their inputs (normalization, Symbol(vega_id) tagging). Never hand them
  // shared state — deep-clone here (specs are small).
  const prepared = prepareVegaLiteSpec(JSON.parse(JSON.stringify(spec)) as Record<string, unknown>);
  if (options?.xLabelAngle != null) injectXLabelAngle(prepared, options.xLabelAngle);
  // Responsive container fill (`width/height: 'container'` is only valid for
  // single/layer specs). Without an explicit width, VL STEP-SIZES discrete axes
  // (band-step × category count) — a 3-category bar renders ~60px wide instead of
  // filling the card. Container sizing flips the scale range to [0, container].
  // An explicit spec width/height/autosize is the author's opt-out (RFC §15).
  const composed = ['hconcat', 'vconcat', 'concat', 'repeat', 'facet'].some(k => k in prepared);
  if (!composed) {
    if (!('width' in prepared)) prepared.width = 'container';
    if (!('height' in prepared)) prepared.height = 'container';
    if (!('autosize' in prepared)) prepared.autosize = { type: 'fit', contains: 'padding' };
  }
  // Legend defaults only for true single-view specs — in composed/layered specs param
  // placement differs per view, so authors declare interactions themselves. Exception:
  // an ANNOTATED unit (base chart + reference-line layers) applies them to its base,
  // so adding a reference line doesn't cost the single-series legend or legend toggle.
  if (!composed && !('layer' in prepared)) {
    injectSingleSeriesLegend(prepared);
    injectLegendToggle(prepared);
    injectHeatmapCellLayout(prepared);
  } else if (!composed) {
    const split = annotationSplit(prepared);
    if (split && split.annotations.length > 0) {
      injectSingleSeriesLegend(split.unit);
      injectLegendToggle(split.unit);
      injectHeatmapCellLayout(split.unit);
      // Reference-line badge BACKING plates: the saved spec tags them with the
      // 'mx-annotation-plate' style and no fill (mode-free on disk); the renderer
      // resolves the opaque surface color here. VL bakes mark fills at compile, so
      // a config.style entry can't do this.
      for (const layer of split.annotations) {
        const mark = layer.mark as Record<string, unknown> | undefined;
        if (mark && typeof mark === 'object' && mark.style === 'mx-annotation-plate' && mark.fill == null) {
          mark.fill = getSurfaceColor(mode);
        }
      }
    }
  }
  // House look: legends are entry labels only, with no redundant heading.
  if (!composed) suppressLegendTitles(prepared);
  const { spec: vegaSpec } = compile(prepared as unknown as TopLevelSpec, { config: getVegaLiteConfig(mode) });
  // Center top legends within the chart width (a Vega-level legend layout — VL's
  // config surface doesn't expose it, so it's merged into the compiled config).
  const cfg = ((vegaSpec as unknown as Record<string, unknown>).config ??= {}) as Record<string, unknown>;
  const legendCfg = (cfg.legend ??= {}) as Record<string, unknown>;
  legendCfg.layout = { top: { anchor: 'middle' }, ...(legendCfg.layout as object | undefined ?? {}) };
  if (options?.legendPlan != null) {
    injectLegendPlan(vegaSpec as unknown as Record<string, unknown>, options.legendPlan);
  }
  return vegaSpec;
}

/**
 * Bind the query result as the reserved named dataset. Rows arrive from Redux
 * (immer-frozen); vega tags each tuple in place with Symbol(vega_id), so it must
 * own the row objects — shallow-clone each (values are scalars, never mutated).
 */
export function setMainData(view: View, rows: Record<string, unknown>[]): void {
  view.data(VIZ_DATASET_MAIN, rows.map(r => ({ ...r })));
}

/** Parse a compiled Vega spec and build a View with the query result bound as 'main'. */
export function createVegaView(
  vegaSpec: VegaSpec,
  rows: Record<string, unknown>[],
  opts: VegaViewOptions,
): View {
  const runtime = parse(vegaSpec, (opts.parserConfig ?? undefined) as never, { ast: true });
  const view = new View(runtime, {
    expr: expressionInterpreter,
    renderer: opts.renderer,
    hover: opts.renderer !== 'none',
    ...(opts.container ? { container: opts.container } : {}),
    ...(opts.container && opts.tooltipTheme
      ? { tooltip: new TooltipHandler({ theme: opts.tooltipTheme }).call }
      : {}),
  });
  setMainData(view, rows);
  if (opts.width != null) view.width(opts.width);
  if (opts.height != null) view.height(opts.height);
  return view;
}

/** Headless render: the server/preview/export/image-attachment path. */
export async function renderVegaLiteToSvg(
  spec: Record<string, unknown>,
  rows: Record<string, unknown>[],
  mode: 'light' | 'dark',
  size?: { width?: number; height?: number },
): Promise<string> {
  const view = createVegaView(compileVegaLite(spec, mode), rows, { renderer: 'none', ...size });
  try {
    await view.runAsync();
    return await view.toSVG();
  } finally {
    view.finalize();
  }
}

/**
 * Browser image export: render a full envelope to a raster canvas (Viz Arch V2 §21
 * item 2, the client path). Unlike the SVG paths this rasterizes through Vega's canvas
 * renderer, so image marks (slippy street TILES) are captured for real — the direct
 * analogue of the ECharts `getDataURL` off-screen render. Browser-only (needs a canvas).
 */
export async function renderEnvelopeToCanvas(
  envelope: VizEnvelope,
  rows: Record<string, unknown>[],
  mode: 'light' | 'dark',
  opts: { width?: number; height?: number; pixelRatio?: number } = {},
): Promise<HTMLCanvasElement> {
  const resolved = resolveEnvelopeSpec(envelope);
  if (!resolved.ok) throw new Error(resolved.error);
  const xLabelAngle = resolved.engine === 'vega-lite'
    ? computeXLabelAngle(resolved.spec, rows, opts.width ?? 640)
    : null;
  const { vegaSpec, parserConfig } = toVegaSpec(resolved, mode, { xLabelAngle });
  const view = createVegaView(vegaSpec, rows, {
    renderer: 'none', parserConfig, width: opts.width, height: opts.height,
  });
  try {
    await injectNamedAssets(view, resolved.assets);
    await view.runAsync();
    return (await view.toCanvas(opts.pixelRatio ?? 1)) as unknown as HTMLCanvasElement;
  } finally {
    view.finalize();
  }
}

/** Headless render of a full envelope (any source kind / engine). */
export async function renderEnvelopeToSvg(
  envelope: VizEnvelope,
  rows: Record<string, unknown>[],
  mode: 'light' | 'dark',
  size?: { width?: number; height?: number },
): Promise<string> {
  const resolved = resolveEnvelopeSpec(envelope);
  if (!resolved.ok) throw new Error(resolved.error);
  const xLabelAngle = resolved.engine === 'vega-lite'
    ? computeXLabelAngle(resolved.spec, rows, size?.width ?? 640)
    : null;
  const { vegaSpec, parserConfig } = toVegaSpec(resolved, mode, { xLabelAngle });
  const view = createVegaView(vegaSpec, rows, { renderer: 'none', parserConfig, ...size });
  try {
    await injectNamedAssets(view, resolved.assets);
    await view.runAsync();
    return await view.toSVG();
  } finally {
    view.finalize();
  }
}
