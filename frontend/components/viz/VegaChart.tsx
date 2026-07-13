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
import type { View } from 'vega';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { createVegaView, setMainData, resolveEnvelopeSpec, toVegaSpec, computeLegendPlan, injectNamedAssets } from '@/lib/viz/render-vega';

// Recipes that render an interactive map (drag pan, wheel zoom, +/- buttons) and
// expose an `mxViewParams` signal for persistence.
const POINT_MAP_RECIPE = 'minusx/point-map@1';
const CHOROPLETH_RECIPE = 'minusx/choropleth@1';
const recipeOf = (env: VizEnvelope): string | undefined => (env.source as unknown as { recipe?: string })?.recipe;
const isInteractiveMap = (env: VizEnvelope): boolean =>
  recipeOf(env) === POINT_MAP_RECIPE || recipeOf(env) === CHOROPLETH_RECIPE;
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
  const legendPlanRef = useRef<string>('null');
  const vlSpecRef = useRef<Record<string, unknown> | null>(null);

  const replanLegendWrap = useCallback(() => {
    const el = containerRef.current;
    const spec = vlSpecRef.current;
    if (!el || !spec) return;
    const next = JSON.stringify(computeLegendPlan(spec, rowsRef.current, el.clientWidth) ?? null);
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
        legendPlanRef.current = JSON.stringify(legendPlan ?? null);
        const { vegaSpec, parserConfig } = toVegaSpec(resolved, colorMode, { legendPlan });
        if (cancelled) return;
        el.replaceChildren(); // drop any stale chart DOM from a failed predecessor
        view = createVegaView(vegaSpec, rowsRef.current, {
          renderer: 'svg',
          container: el,
          tooltipTheme: colorMode,
          parserConfig,
          ...sizeOf(el),
        });
        viewRef.current = view;
        // Recipe boundary/lookup datasets (choropleth & analytic geo, RFC §9) are
        // resolved from the asset registry and bound before the first layout.
        await injectNamedAssets(view, resolved.ok ? resolved.assets : undefined);
        if (cancelled) return;
        await view.runAsync();
        promoteFontAttrs(el);
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
      view?.finalize();
    };
  }, [envelope, colorMode, legendEpoch]);

  // Data-only updates: no rebuild — unless the new rows change the legend plan.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    setMainData(view, rows);
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

  // Interactive maps get Google-Maps-style +/- zoom buttons. point_map's zoom is an
  // absolute `scaleUser`; choropleth's is a `zoomUser` multiplier — nudge the right
  // override, then persist the settled view via `mxViewParams`.
  const showZoomButtons = isInteractiveMap(envelope);
  const zoomBy = useCallback((factor: number) => {
    const view = viewRef.current;
    if (!view) return;
    const recipe = recipeOf(envelope);
    if (recipe === POINT_MAP_RECIPE) {
      const cur = view.signal('scale') as number;
      if (!Number.isFinite(cur)) return;
      view.signal('scaleUser', Math.max(40, Math.min(4_000_000, cur * factor)));
    } else if (recipe === CHOROPLETH_RECIPE) {
      const cur = view.signal('zoom') as number;
      if (!Number.isFinite(cur)) return;
      view.signal('zoomUser', Math.max(0.2, Math.min(40, cur * factor)));
    } else {
      return;
    }
    view.runAsync().catch(() => { /* race on unmount */ });
    const params = view.signal('mxViewParams') as Record<string, unknown> | undefined;
    if (params) onViewChangeRef.current?.(roundViewParams(params));
  }, [envelope]);

  // The container must ALWAYS stay mounted: the build effect needs containerRef on
  // every envelope change. Unmounting it on error made error states permanent (the
  // effect bailed on a null ref forever). Errors overlay instead.
  return (
    <Box position="relative" flex="1" width="full" minHeight="0" overflow="hidden">
      {error && (
        <Box position="absolute" inset={0} zIndex={1} bg="bg.subtle" p={4} overflow="auto" aria-label="Vega chart error">
          <Text fontSize="xs" fontFamily="mono" color="accent.danger" whiteSpace="pre-wrap">
            Chart failed to render: {error}
          </Text>
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
