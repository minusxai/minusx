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
import { getVegaLiteConfig, getVegaParserConfig } from './theme';
import { materializeRecipe } from './viz-templates';
import { VIZ_DATASET_MAIN } from './types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

export type ResolvedEnvelopeSpec =
  | { ok: true; spec: Record<string, unknown>; engine: 'vega-lite' | 'vega' }
  | { ok: false; error: string };

/**
 * Resolve an envelope's renderable spec + grammar engine: native sources return their
 * spec, recipe sources materialize from the shipped registry (render-time, never stored).
 */
export function resolveEnvelopeSpec(envelope: VizEnvelope): ResolvedEnvelopeSpec {
  const source = envelope.source as unknown as Record<string, unknown>;
  if (source.kind === 'recipe') {
    return materializeRecipe(source as unknown as { recipe: string; bindings: Record<string, string> });
  }
  return { ok: true, spec: (source as { spec: Record<string, unknown> }).spec, engine: 'vega-lite' };
}

/**
 * Turn a resolved spec into the parsed-vega inputs: VL specs compile (theme embedded
 * in the VL config); native Vega specs go straight to parse with the themed parser
 * config. One divergence point, both tiers themed from the same tokens.
 */
export function toVegaSpec(
  resolved: { spec: Record<string, unknown>; engine: 'vega-lite' | 'vega' },
  mode: 'light' | 'dark',
): { vegaSpec: VegaSpec; parserConfig?: Record<string, unknown> } {
  if (resolved.engine === 'vega') {
    return { vegaSpec: resolved.spec as unknown as VegaSpec, parserConfig: getVegaParserConfig(mode) };
  }
  return { vegaSpec: compileVegaLite(resolved.spec, mode) };
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

export function compileVegaLite(spec: Record<string, unknown>, mode: 'light' | 'dark'): VegaSpec {
  // Ownership boundary: specs arrive from Redux (immer deep-frozen) and vega-lite/vega
  // mutate their inputs (normalization, Symbol(vega_id) tagging). Never hand them
  // shared state — deep-clone here (specs are small).
  const prepared = prepareVegaLiteSpec(JSON.parse(JSON.stringify(spec)) as Record<string, unknown>);
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
  // placement differs per view, so authors declare interactions themselves.
  if (!composed && !('layer' in prepared)) {
    injectSingleSeriesLegend(prepared);
    injectLegendToggle(prepared);
    injectHeatmapCellLayout(prepared);
  }
  const { spec: vegaSpec } = compile(prepared as unknown as TopLevelSpec, { config: getVegaLiteConfig(mode) });
  // Center top legends within the chart width (a Vega-level legend layout — VL's
  // config surface doesn't expose it, so it's merged into the compiled config).
  const cfg = ((vegaSpec as unknown as Record<string, unknown>).config ??= {}) as Record<string, unknown>;
  const legendCfg = (cfg.legend ??= {}) as Record<string, unknown>;
  legendCfg.layout = { top: { anchor: 'middle' }, ...(legendCfg.layout as object | undefined ?? {}) };
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

/** Headless render of a full envelope (any source kind / engine). */
export async function renderEnvelopeToSvg(
  envelope: VizEnvelope,
  rows: Record<string, unknown>[],
  mode: 'light' | 'dark',
  size?: { width?: number; height?: number },
): Promise<string> {
  const resolved = resolveEnvelopeSpec(envelope);
  if (!resolved.ok) throw new Error(resolved.error);
  const { vegaSpec, parserConfig } = toVegaSpec(resolved, mode);
  const view = createVegaView(vegaSpec, rows, { renderer: 'none', parserConfig, ...size });
  try {
    await view.runAsync();
    return await view.toSVG();
  } finally {
    view.finalize();
  }
}
