'use client';

/**
 * <VegaChart> — the single browser renderer for Viz V2 envelopes (RFC §3).
 * Pure view: envelope + rows + colorMode in, chart out. No Redux.
 *
 * Lifecycle: compile+parse+mount on spec/mode change (theme change = recompile,
 * RFC §7); data-only updates flow through view.data() without a rebuild; container
 * resizes update the width/height signals; every view is finalized on unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, IconButton, VStack } from '@chakra-ui/react';
import { ChartError } from '@/components/plotx/ChartError';
import type { View } from 'vega';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { createVegaView, setMainData, resolveEnvelopeSpec, toVegaSpec, computeLegendPlan, computeXLabelAngle, injectNamedAssets } from '@/lib/viz/render-vega';
import { chartTokenRangeFromElement } from '@/lib/viz/chart-tokens';
import { POINT_MAP_DEFAULT_TILE_URL, POINT_MAP_DARK_TILE_URL } from '@/lib/viz/viz-templates';
import { buildTooltipPlan, buildTooltipData, renderSharedTooltipHtml, type TooltipPlan, type TooltipEntry } from '@/lib/viz/tooltip-plan';
import { SharedTooltip } from '@/lib/viz/shared-tooltip';
import { injectGuideMark, GUIDE_WIDTH, GUIDE_OPACITY, GUIDE_BAND_OPACITY } from '@/lib/viz/guide-mark';

// Tooltip value/x formatters. Tooltips show the FULL number ("2,574", not the axis's
// "2.6k") and a readable date — the chart's own d3 format is for the axis, not here.
const fmtTooltipValue = (v: number): string =>
  Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const makeXFormatter = (plan: TooltipPlan) => (raw: unknown): string => {
  if (!plan.xTemporal) return String(raw);
  const d = new Date(raw as string | number | Date);
  return Number.isNaN(+d) ? String(raw) : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
};

// The shared-tooltip guide line (a native Vega `rule` mark driven by mxGuidePx/mxGuideOn/
// mxGuideH signals) lives in ./guide-mark — extracted so its bounds invariant is
// unit-tested (mxGuideH rests at 0 so the guide never feeds the fit solver; see guide-mark.ts).

// Interactive maps (drag pan, wheel zoom, +/- buttons, persisted view) are detected by
// CAPABILITY — the `mxViewParams` signal — not by recipe id, so a DETACHED map (kind:
// 'vega', no recipe) stays fully interactive. Recipe ids are still a fast path.
const POINT_MAP_RECIPE = 'minusx/point-map@1';
const CHOROPLETH_RECIPE = 'minusx/choropleth@1';
const recipeOf = (env: VizEnvelope): string | undefined => (env.source as unknown as { recipe?: string })?.recipe;
// Does a raw (detached) native-Vega spec declare this signal? Lets map capabilities
// survive detach, when the recipe id is gone but the signals remain in the spec.
const specHasSignal = (env: VizEnvelope, name: string): boolean => {
  const src = env.source as unknown as { kind?: string; spec?: { signals?: Array<{ name?: string }> } };
  return src.kind === 'vega' && Array.isArray(src.spec?.signals) && src.spec.signals.some(s => s?.name === name);
};
const isInteractiveMap = (env: VizEnvelope): boolean =>
  recipeOf(env) === POINT_MAP_RECIPE || recipeOf(env) === CHOROPLETH_RECIPE || specHasSignal(env, 'mxViewParams');
const hasSignal = (view: View, name: string): boolean => {
  try { view.signal(name); return true; } catch { return false; }
};
/** Round numeric view params (and numeric array members) for a small, stable payload. */
const roundViewParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const r = (n: unknown) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v.map(r) : r(v)]));
};

export interface VegaChartProps {
  envelope: VizEnvelope;
  rows: Record<string, unknown>[];
  colorMode: 'light' | 'dark';
  /**
   * Fired after the user pans/zooms an interactive map (point_map / choropleth): the
   * settled view state as recipe params (point_map → `{center, zoom}`; choropleth →
   * `{zoom, panX, panY}`), read from the recipe's `mxViewParams` signal. The container
   * persists each via setRecipeParam so Save/reload restores the view. Debounced; only
   * fires on real interaction (never on initial render).
   */
  onViewChange?: (params: Record<string, unknown>) => void;
}

// Vega's width/height signals size the data rectangle; axes/legends draw in the
// padding. autosize fit+contains:padding (applied at compile) keeps the total within
// the container, but the initial signal still needs a sane starting size.
const sizeOf = (el: HTMLElement) => ({
  width: Math.max(el.clientWidth, 80),
  height: Math.max(el.clientHeight, 60),
});

// Vega writes fonts as SVG presentation attributes, which lose to ANY author CSS rule —
// including Chakra's `@layer reset` universal preflight. The app font then overrides
// every chart label (measured mono, rendered sans → all spacing wrong). Promote vega's
// font-* attributes to inline styles, which win the cascade. Re-applied via a
// MutationObserver because vega rewrites text nodes on every dataflow re-render.
const FONT_ATTRS = [
  ['font-family', 'fontFamily'],
  ['font-size', 'fontSize'],
  ['font-weight', 'fontWeight'],
  ['font-style', 'fontStyle'],
] as const;

function promoteFontAttrs(root: HTMLElement): void {
  for (const t of root.querySelectorAll('svg text')) {
    for (const [attr, prop] of FONT_ATTRS) {
      const v = t.getAttribute(attr);
      if (v && (t as SVGTextElement).style[prop] !== v) (t as SVGTextElement).style[prop] = v;
    }
  }
}

export function VegaChart({ envelope, rows, colorMode, onViewChange }: VegaChartProps) {
  // Latest callback without retriggering the build effect.
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => { onViewChangeRef.current = onViewChange; });
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const rowsRef = useRef(rows);
  const [error, setError] = useState<string | null>(null);
  // Legend wrap is a compile-time CONSTANT (computeLegendPlan) — when a
  // resize or data change flips the decision, the view must be rebuilt (the
  // plan is baked into the parsed runtime). The epoch re-arms the build
  // effect only on an actual flip; plain resizes stay signal-only updates.
  const [legendEpoch, setLegendEpoch] = useState(0);
  // Design-theme chart tokens (Story_Design_V2 §5): `--chart-1..5` from the surrounding
  // [data-theme] scope drive the categorical range; a theme switch (a data-theme attribute
  // change anywhere in this document) bumps the epoch so the view rebuilds with new colors.
  const [themeEpoch, setThemeEpoch] = useState(0);
  const legendPlanRef = useRef<string>('null');
  const vlSpecRef = useRef<Record<string, unknown> | null>(null);
  // Shared multi-series tooltip state (rebuilt per view; data re-indexed on row change).
  const tooltipRef = useRef<{ plan: TooltipPlan; controller: SharedTooltip; holder: { data: Map<string, TooltipEntry> }; cleanup: () => void } | null>(null);

  const replanLegendWrap = useCallback(() => {
    const el = containerRef.current;
    const spec = vlSpecRef.current;
    if (!el || !spec) return;
    // One fingerprint for every compile-time-planned constant (legend wrap +
    // x label angle) — a resize that flips either decision rebuilds the view.
    const next = JSON.stringify({
      legend: computeLegendPlan(spec, rowsRef.current, el.clientWidth) ?? null,
      xAngle: computeXLabelAngle(spec, rowsRef.current, el.clientWidth),
    });
    if (next !== legendPlanRef.current) setLegendEpoch(e => e + 1);
  }, []);

  // Keep the latest rows readable by the build effect without retriggering it.
  // (Declared BEFORE the build effect — effects run in declaration order.)
  useEffect(() => {
    rowsRef.current = rows;
  });

  // Build (and rebuild) the view when the spec or color mode changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let view: View | null = null;
    let cancelled = false;
    // Async so state updates never fire synchronously inside the effect body.
    (async () => {
      try {
        // Vega measures label widths via canvas measureText — if JetBrains Mono isn't
        // loaded yet it measures the fallback font and underestimates every label,
        // producing crowded/overlapping ticks. Wait for fonts before the first layout.
        if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready;
        if (cancelled) return;
        const resolved = resolveEnvelopeSpec(envelope);
        if (!resolved.ok) throw new Error(resolved.error);
        vlSpecRef.current = resolved.engine === 'vega-lite' ? resolved.spec : null;
        const legendPlan = vlSpecRef.current
          ? computeLegendPlan(vlSpecRef.current, rowsRef.current, el.clientWidth)
          : null;
        const xLabelAngle = vlSpecRef.current
          ? computeXLabelAngle(vlSpecRef.current, rowsRef.current, el.clientWidth)
          : null;
        legendPlanRef.current = JSON.stringify({ legend: legendPlan ?? null, xAngle: xLabelAngle });
        // Theme chart tokens: computed --chart-1..5 at the container (null outside a token
        // scope → house palette). Resolved per build so a [data-theme] switch recolors.
        const categoryRange = chartTokenRangeFromElement(el);
        const { vegaSpec, parserConfig } = toVegaSpec(resolved, colorMode, { legendPlan, xLabelAngle, categoryRange });
        // Shared-tooltip charts get a guide-line rule injected BEHIND the data (before parse).
        const tooltipPlan = vlSpecRef.current ? buildTooltipPlan(vlSpecRef.current) : null;
        const hasGuide = tooltipPlan ? injectGuideMark(vegaSpec as Record<string, unknown>) : false;
        if (cancelled) return;
        el.replaceChildren(); // drop any stale chart DOM from a failed predecessor
        view = createVegaView(vegaSpec, rowsRef.current, {
          // Always vega's SVG renderer: captures serialize the live DOM (Story_Design_V2 §4/§7 —
          // <canvas> content serializes empty, so charts must be SVG in every captured surface).
          renderer: 'svg',
          container: el,
          tooltipTheme: colorMode,
          parserConfig,
          ...sizeOf(el),
        });
        viewRef.current = view;
        // Vega LOGS dataflow errors (an invalid axis format, a broken expression…)
        // instead of rejecting runAsync — the view is left broken and the chart shows
        // as a SILENT blank. Collect logged errors and promote the first one to a real
        // throw after the first run, so it lands on the error card like any failure.
        const loggedErrors: unknown[] = [];
        view.logger({
          level(): never { return this as never; },
          error(...args: unknown[]) { loggedErrors.push(args[0]); console.error('[VegaChart] vega error:', ...args); return this; },
          warn(...args: unknown[]) { console.warn('[VegaChart]', ...args); return this; },
          info() { return this; },
          debug() { return this; },
        } as never);
        // Shared-tooltip charts suppress the DEFAULT per-mark tooltip — and this MUST
        // happen before the first runAsync: vega's View.tooltip() re-initializes the
        // renderer, which synchronously CLEARS the SVG. Calling it after the first
        // render wiped the just-painted chart with no error, and nothing repainted
        // until the next interaction-triggered run (the silent-blank-chart bug).
        if (tooltipPlan) view.tooltip(() => {});
        // Recipe boundary/lookup datasets (choropleth & analytic geo, RFC §9) are
        // resolved from the asset registry and bound before the first layout.
        await injectNamedAssets(view, resolved.ok ? resolved.assets : undefined);
        // Street-tile basemap follows the app theme: swap the default Carto tiles to the
        // dark set in dark mode. Capability-based (any map with a `tileUrlTemplate` signal,
        // recipe OR detached), and only when the URL is still a Carto default — a custom
        // `tileUrl` the user/agent set is left untouched.
        if (hasSignal(view, 'tileUrlTemplate')) {
          const cur = view.signal('tileUrlTemplate');
          if (cur === POINT_MAP_DEFAULT_TILE_URL || cur === POINT_MAP_DARK_TILE_URL) {
            view.signal('tileUrlTemplate', colorMode === 'dark' ? POINT_MAP_DARK_TILE_URL : POINT_MAP_DEFAULT_TILE_URL);
          }
        }
        if (cancelled) return;
        await view.runAsync();
        if (loggedErrors.length > 0) {
          const first = loggedErrors[0];
          throw first instanceof Error ? first : new Error(String(first));
        }
        promoteFontAttrs(el);
        // Shared multi-series tooltip (ECharts-style axis tooltip): for cartesian charts
        // with a shared x, hovering shows EVERY series at that x with a color swatch + a
        // vertical guide line. Overrides the default per-mark tooltip; other charts (pie,
        // scatter, maps) keep it. `data` is re-indexed on row change (see the data effect).
        if (cancelled) return;
        if (tooltipPlan) {
          const plan = tooltipPlan;
          // Capture LOCALS in the handler (not tooltipRef) so a StrictMode/rebuild race can't
          // null it out. `holder.data` is re-indexed on row change.
          const controller = new SharedTooltip(colorMode);
          const holder = { data: buildTooltipData(rowsRef.current, plan) };
          const formatX = makeXFormatter(plan);
          const v = view; // default per-mark tooltip already suppressed pre-run (above)

          // bandW > 0 (bar/band x scale) → grow the guide to the whole category slot, an
          // ECharts `axisPointer: 'shadow'`. 0 (line/area/scatter — point/linear x) → thin line.
          const setGuide = (on: boolean, px = -1, bandW = 0) => {
            if (!hasGuide) return;
            v.signal('mxGuideOn', on ? 1 : 0);
            if (on) {
              v.signal('mxGuidePx', px);
              // Grow the guide to the (now-settled) plot height ONLY on hover; it rests at
              // 0 so it never feeds the autosize:fit solve on first paint (see guide-mark.ts).
              v.signal('mxGuideH', Number(v.height()) || 0);
              v.signal('mxGuideW', bandW > 0 ? bandW : GUIDE_WIDTH);
              v.signal('mxGuideOpacity', bandW > 0 ? GUIDE_BAND_OPACITY : GUIDE_OPACITY);
            }
            v.runAsync().catch(() => { /* race on unmount */ });
          };
          const hideAll = () => { controller.hide(); setGuide(false); };

          // ECharts-style AXIS trigger: hovering ANYWHERE in the plot snaps to the nearest x.
          // The guide is a Vega rule at `mxGuidePx` (data-rect px) so it lands EXACTLY on the
          // point and renders behind the bars; the tooltip card rides the cursor. rAF-throttled.
          let raf = 0, pending: PointerEvent | null = null;
          const process = (e: PointerEvent) => {
            const svg = el.querySelector('svg');
            const xs = v.scale('x') as (((d: unknown) => number) & { bandwidth?: () => number }) | undefined;
            if (!svg || typeof xs !== 'function') { hideAll(); return; }
            // Band scales (bar charts) expose bandwidth() → the full category-slot width.
            const bandW = typeof xs.bandwidth === 'function' ? xs.bandwidth() : 0;
            const rect = svg.getBoundingClientRect();
            const origin = (v as unknown as { _origin?: [number, number] })._origin ?? [0, 0];
            const width = Number(v.width());
            const height = Number(v.height());
            const dataX = e.clientX - rect.left - origin[0];
            const dataY = e.clientY - rect.top - origin[1];
            if (dataX < -6 || dataX > width + 6 || dataY < -6 || dataY > height + 6) { hideAll(); return; }
            let best: TooltipEntry | null = null, bestDist = Infinity, bestPx = 0;
            for (const entry of holder.data.values()) {
              // xPlot (bin centers) positions on the scale; xRaw is the display label.
              const sv = entry.xPlot ?? (plan.xTemporal ? new Date(entry.xRaw as string | number | Date) : entry.xRaw);
              let px = xs(sv);
              if (typeof px !== 'number' || Number.isNaN(px)) continue;
              px += bandW / 2; // band scales anchor at the slot's left edge → shift to center
              const d = Math.abs(px - dataX);
              if (d < bestDist) { bestDist = d; best = entry; bestPx = px; }
            }
            if (!best) { hideAll(); return; }
            // Charts with only literal colors (waterfall, boxplot) have NO color scale —
            // view.scale('color') itself throws, so the lookup goes inside the guard too.
            const colorFor = (k: string) => {
              try {
                const scale = v.scale('color') as ((key: string) => string) | undefined;
                return scale ? String(scale(k)) : '#8b949e';
              } catch { return '#8b949e'; }
            };
            // bins/stats/waterfall rows are ORDERED summaries (Max→Min, change→total) —
            // value-sorting only applies to real multi-series (wide/long) charts.
            const sortByValue = plan.series.kind === 'wide' || plan.series.kind === 'long';
            controller.show(renderSharedTooltipHtml(best, { xTitle: plan.xTitle, colorFor, formatX, formatValue: fmtTooltipValue, sortByValue }), e.clientX, e.clientY);
            setGuide(true, bestPx, bandW);
          };
          const onMove = (e: PointerEvent) => {
            pending = e;
            if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) process(pending); });
          };
          const onLeave = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } pending = null; hideAll(); };
          el.addEventListener('pointermove', onMove);
          el.addEventListener('pointerleave', onLeave);
          tooltipRef.current = { plan, controller, holder, cleanup: () => {
            if (raf) cancelAnimationFrame(raf);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerleave', onLeave);
          } };
        }
        // Interactive maps (point_map / choropleth) expose an `mxViewParams` signal —
        // the settled view state as recipe params. Persist it after a real pan/wheel
        // (never on initial render), debounced, rounded.
        if (isInteractiveMap(envelope) && hasSignal(view, 'mxViewParams')) {
          const v = view; // non-null here; keep it out of the nullable closure capture
          let interacted = false;
          let debounce: ReturnType<typeof setTimeout> | undefined;
          v.addEventListener('pointerdown', () => { interacted = true; });
          v.addEventListener('wheel', () => { interacted = true; });
          const persist = () => {
            if (!interacted) return;
            clearTimeout(debounce);
            debounce = setTimeout(() => {
              const params = v.signal('mxViewParams') as Record<string, unknown> | undefined;
              if (params) onViewChangeRef.current?.(roundViewParams(params));
            }, 500);
          };
          v.addSignalListener('mxViewParams', persist);
        }
        if (!cancelled) setError(null);
        // The container may not have been laid out when the plan above ran (a
        // dashboard tile mounts at ~0 width; fonts.ready also loses the race
        // against the first ResizeObserver tick). Re-plan against the settled
        // width — a flip bumps the epoch and rebuilds once.
        if (!cancelled) replanLegendWrap();
      } catch (e) {
        // Full stack to the console — the error box shows only the message.
        console.error('[VegaChart] render failed:', e);
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      viewRef.current = null;
      tooltipRef.current?.cleanup();
      tooltipRef.current?.controller.destroy();
      tooltipRef.current = null;
      view?.finalize();
    };
  }, [envelope, colorMode, legendEpoch, themeEpoch]);

  // Rebuild when the surrounding design theme changes: observe data-theme attribute flips in
  // this chart's OWN document (story charts live in the story iframe). Fires only on an actual
  // theme switch — never during normal renders — so the observer is effectively free.
  useEffect(() => {
    const docEl = containerRef.current?.ownerDocument?.documentElement;
    if (!docEl || typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => setThemeEpoch(e => e + 1));
    mo.observe(docEl, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  // Data-only updates: no rebuild — unless the new rows change the legend plan.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    setMainData(view, rows);
    // Keep the shared-tooltip index in sync with the live rows (no view rebuild).
    if (tooltipRef.current) tooltipRef.current.holder.data = buildTooltipData(rows, tooltipRef.current.plan);
    view.runAsync().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    replanLegendWrap();
  }, [rows, replanLegendWrap]);

  // Re-promote font attrs whenever vega rewrites text nodes (data/resize re-renders).
  // 'style' is not in the filter, so our own writes can't retrigger the observer.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const mo = new MutationObserver(() => promoteFontAttrs(el));
    mo.observe(el, { childList: true, subtree: true, attributeFilter: ['font-family', 'font-size', 'font-weight', 'font-style'] });
    return () => mo.disconnect();
  }, []);

  // Container resizes drive the size signals.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Re-plan even mid-build (view not ready yet): the initial tick carries
      // the first REAL container width, which the in-flight build may have
      // missed — skipping it here left a phantom 1-column legend baked in.
      replanLegendWrap();
      const view = viewRef.current;
      if (!view) return;
      const { width, height } = sizeOf(el);
      view.width(width).height(height).runAsync().catch(() => { /* resize race on unmount */ });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [replanLegendWrap]);

  // Interactive maps get Google-Maps-style +/- zoom buttons. Detected by signal, not
  // recipe id, so DETACHED maps keep them. A point-map style has an absolute `scaleUser`;
  // choropleth has a `zoomUser` multiplier — nudge whichever the view exposes, then
  // persist the settled view via `mxViewParams`.
  const showZoomButtons = isInteractiveMap(envelope);
  const zoomBy = useCallback((factor: number) => {
    const view = viewRef.current;
    if (!view) return;
    if (hasSignal(view, 'scaleUser')) {
      const cur = view.signal('scale') as number;
      if (!Number.isFinite(cur)) return;
      view.signal('scaleUser', Math.max(40, Math.min(8_000_000, cur * factor)));
    } else if (hasSignal(view, 'zoomUser')) {
      const cur = view.signal('zoom') as number;
      if (!Number.isFinite(cur)) return;
      view.signal('zoomUser', Math.max(0.2, Math.min(40, cur * factor)));
    } else {
      return;
    }
    view.runAsync().catch(() => { /* race on unmount */ });
    const params = view.signal('mxViewParams') as Record<string, unknown> | undefined;
    if (params) onViewChangeRef.current?.(roundViewParams(params));
  }, []);

  // The container must ALWAYS stay mounted: the build effect needs containerRef on
  // every envelope change. Unmounting it on error made error states permanent (the
  // effect bailed on a null ref forever). Errors overlay instead.
  return (
    <Box position="relative" flex="1" width="full" minHeight="0" overflow="hidden">
      {error && (
        <Box position="absolute" inset={0} zIndex={1} bg="bg.subtle" overflow="auto" aria-label="Vega chart error">
          {/* Same friendly card as the classic charts (V1 parity); the full stack is
              already on the console from the build effect's catch. */}
          <ChartError message={error} />
        </Box>
      )}
      <Box
        ref={containerRef}
        aria-label="Vega chart"
        width="full"
        height="100%"
        overflow="hidden"
        css={{ '& .vega-embed, & svg': { display: 'block' } }}
      />
      {showZoomButtons && !error && (
        <VStack position="absolute" bottom={2} right={2} zIndex={2} gap="1px" borderRadius="md" overflow="hidden" boxShadow="sm">
          <IconButton aria-label="Zoom in" size="xs" variant="solid" bg="bg.panel" color="fg.default" borderRadius={0} onClick={() => zoomBy(1.5)}>
            <Text fontSize="md" lineHeight="1">+</Text>
          </IconButton>
          <IconButton aria-label="Zoom out" size="xs" variant="solid" bg="bg.panel" color="fg.default" borderRadius={0} onClick={() => zoomBy(1 / 1.5)}>
            <Text fontSize="md" lineHeight="1">−</Text>
          </IconButton>
        </VStack>
      )}
    </Box>
  );
}

export default VegaChart;
