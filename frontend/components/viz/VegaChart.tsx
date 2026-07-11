'use client';

/**
 * <VegaChart> — the single browser renderer for Viz V2 envelopes (RFC §3).
 * Pure view: envelope + rows + colorMode in, chart out. No Redux.
 *
 * Lifecycle: compile+parse+mount on spec/mode change (theme change = recompile,
 * RFC §7); data-only updates flow through view.data() without a rebuild; container
 * resizes update the width/height signals; every view is finalized on unmount.
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Text } from '@chakra-ui/react';
import type { View } from 'vega';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { compileVegaLite, createVegaView, setMainData } from '@/lib/viz/render-vega';

export interface VegaChartProps {
  envelope: VizEnvelope;
  rows: Record<string, unknown>[];
  colorMode: 'light' | 'dark';
}

// Vega's width/height signals size the data rectangle; axes/legends draw in the
// padding. autosize fit+contains:padding (applied at compile) keeps the total within
// the container, but the initial signal still needs a sane starting size.
const sizeOf = (el: HTMLElement) => ({
  width: Math.max(el.clientWidth, 80),
  height: Math.max(el.clientHeight, 60),
});

export function VegaChart({ envelope, rows, colorMode }: VegaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const rowsRef = useRef(rows);
  const [error, setError] = useState<string | null>(null);

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
        const vegaSpec = compileVegaLite(envelope.source.spec as Record<string, unknown>, colorMode);
        if (cancelled) return;
        view = createVegaView(vegaSpec, rowsRef.current, {
          renderer: 'svg',
          container: el,
          tooltipTheme: colorMode,
          ...sizeOf(el),
        });
        viewRef.current = view;
        await view.runAsync();
        if (!cancelled) setError(null);
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
  }, [envelope, colorMode]);

  // Data-only updates: no rebuild.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    setMainData(view, rows);
    view.runAsync().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [rows]);

  // Container resizes drive the size signals.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const view = viewRef.current;
      if (!view) return;
      const { width, height } = sizeOf(el);
      view.width(width).height(height).runAsync().catch(() => { /* resize race on unmount */ });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (error) {
    return (
      <Box p={4} width="full" aria-label="Vega chart error">
        <Text fontSize="xs" fontFamily="mono" color="accent.danger" whiteSpace="pre-wrap">
          Chart failed to render: {error}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      aria-label="Vega chart"
      flex="1"
      width="full"
      minHeight="0"
      overflow="hidden"
      css={{ '& .vega-embed, & svg': { display: 'block' } }}
    />
  );
}

export default VegaChart;
