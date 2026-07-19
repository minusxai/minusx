'use client';

/**
 * Vega embed for the /debug visualization: compiles the stacked-bar spec
 * through the house render pipeline (theme + CSP-safe interpreter + tooltip
 * handler) and binds the component rows as the reserved named dataset.
 * Clicking a segment resolves the datum back to (barIndex, componentIndex)
 * for the read-only inspector.
 */
import { useEffect, useRef } from 'react';
import { Box } from '@chakra-ui/react';
import type { View } from 'vega';
import { compileVegaLite, createVegaView } from '@/lib/viz/render-vega';
import { buildDebugVegaSpec, type CostMode } from '@/lib/convo-debug';
import type { TurnBar } from '@/lib/convo-debug/types';

interface ConvoDebugChartProps {
  bars: TurnBar[];
  costMode: CostMode;
  colorMode: 'light' | 'dark';
  onInspect: (barIndex: number, componentIndex: number) => void;
}

export default function ConvoDebugChart({ bars, costMode, colorMode, onInspect }: ConvoDebugChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onInspectRef = useRef(onInspect);
  useEffect(() => {
    onInspectRef.current = onInspect;
  }, [onInspect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

    let view: View | null = null;
    let cancelled = false;

    const render = () => {
      const { spec, rows } = buildDebugVegaSpec(bars, costMode);
      const vegaSpec = compileVegaLite(spec, colorMode);
      const width = Math.max(container.clientWidth - 40, 320);
      const height = Math.max(container.clientHeight - 60, 240);
      const next = createVegaView(vegaSpec, rows, {
        renderer: 'svg',
        container,
        tooltipTheme: colorMode,
        width,
        height,
      });
      next.addEventListener('click', (_event, item) => {
        const datum = item?.datum as { barIndex?: number; componentIndex?: number } | undefined;
        if (datum?.barIndex != null && datum.componentIndex != null) {
          onInspectRef.current(datum.barIndex, datum.componentIndex);
        }
      });
      void next.runAsync().then(() => {
        if (cancelled) next.finalize();
      });
      view?.finalize();
      view = next;
    };

    render();
    const observer = new ResizeObserver(() => render());
    observer.observe(container);
    return () => {
      cancelled = true;
      observer.disconnect();
      view?.finalize();
      view = null;
    };
  }, [bars, costMode, colorMode]);

  return <Box ref={containerRef} aria-label="conversation debug chart" flex="1" minH="300px" w="100%" />;
}
