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
import { prepareVegaLiteSpec } from './prepare';
import { getVegaLiteConfig } from './theme';
import { VIZ_DATASET_MAIN } from './types';

export interface VegaViewOptions {
  renderer: 'svg' | 'canvas' | 'none';
  /** DOM container (browser only). */
  container?: HTMLElement;
  width?: number;
  height?: number;
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
  // `fit` is invalid for concat/repeat/facet composition — VL warns and falls back, so
  // only default it for specs where it applies cleanly.
  const composed = ['hconcat', 'vconcat', 'concat', 'repeat', 'facet'].some(k => k in prepared);
  if (!('autosize' in prepared) && !composed) {
    prepared.autosize = { type: 'fit', contains: 'padding' };
  }
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
