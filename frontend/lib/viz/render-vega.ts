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
import { getVegaLiteConfig } from './theme';
import { materializeRecipe } from './viz-templates';
import { VIZ_DATASET_MAIN } from './types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

/**
 * Resolve an envelope's renderable Vega-Lite spec: native sources return their spec,
 * recipe sources materialize from the shipped registry (render-time, never stored).
 */
export function resolveEnvelopeSpec(envelope: VizEnvelope):
  | { ok: true; spec: Record<string, unknown> }
  | { ok: false; error: string } {
  const source = envelope.source as unknown as Record<string, unknown>;
  if (source.kind === 'recipe') {
    return materializeRecipe(source as unknown as { recipe: string; bindings: Record<string, string> });
  }
  return { ok: true, spec: (source as { spec: Record<string, unknown> }).spec };
}

export interface VegaViewOptions {
  renderer: 'svg' | 'canvas' | 'none';
  /** DOM container (browser only). */
  container?: HTMLElement;
  width?: number;
  height?: number;
  /** Install the styled HTML tooltip handler (browser only; styled in globals.css). */
  tooltipTheme?: 'light' | 'dark';
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
  // Legend toggle only for true single-view specs — in composed/layered specs param
  // placement differs per view, so authors declare interactions themselves.
  if (!composed && !('layer' in prepared)) injectLegendToggle(prepared);
  const { spec: vegaSpec } = compile(prepared as unknown as TopLevelSpec, { config: getVegaLiteConfig(mode) });
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
  const runtime = parse(vegaSpec, undefined, { ast: true });
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
