'use client';

/**
 * Canvas story renderer (Settings → "Use Canvas Renderer").
 *
 * A thin composition over lib/canvas-story — each subsystem is a deep hook there:
 *   useStoryRaster     — fluid measurement + takumi raster + bitmap
 *   useCanvasSelection — compositor + drag/word/copy selection over run geometry
 *   useEmbedIslands    — live embed host elements + StoryEmbeds targets
 *   useStoryCapture    — idle island bitmaps + snapdom-free capture provider
 *
 * The story's static surface (text, layout, typography, backgrounds) is a single
 * bitmap on a <canvas>. Embeds (saved/inline questions, inline numbers, param
 * controls) mount as live islands positioned over their measured boxes, hydrated by
 * the SAME StoryEmbeds component the DOM/iframe path uses — embed behavior is
 * identical by construction. Any pipeline failure flips to the DOM `fallback`.
 */

import { Box, Theme } from '@chakra-ui/react';
import { useRef, useState } from 'react';
import StoryEmbeds from '@/components/views/shared/StoryEmbeds';
import { STORY_DPR } from '@/lib/canvas-story/types';
import { useStoryRaster } from '@/lib/canvas-story/use-story-raster';
import { useCanvasSelection } from '@/lib/canvas-story/use-canvas-selection';
import { useEmbedIslands } from '@/lib/canvas-story/use-embed-islands';
import { useIslandMeasurement } from '@/lib/canvas-story/use-island-measurement';
import { useStoryCapture } from '@/lib/canvas-story/use-story-capture';

export interface CanvasStoryViewProps {
  html: string;
  compiledCss?: string | null;
  width: number;
  readOnly: boolean;
  paramValues?: Record<string, unknown>;
  onParamValuesChange?: (values: Record<string, unknown>) => void;
  storyPath?: string;
  colorMode?: 'light' | 'dark';
  /** Rendered instead when the canvas pipeline fails (DOM/iframe path). */
  fallback: React.ReactNode;
}

// Concrete font stacks for embed islands (iframe-parity fallbacks). Defined BOTH on
// the Theme wrapper and inline on every island host: snapdom captures the island
// subtree only, so var definitions on ancestors outside it are lost in the clone —
// captured charts then fall back to the UA serif. Inline style survives the clone.
const ISLAND_FONT_VARS = {
  '--font-inter': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  '--font-jetbrains-mono': "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
} as React.CSSProperties;

export default function CanvasStoryView(props: CanvasStoryViewProps) {
  const { html, compiledCss, width, readOnly, paramValues, onParamValuesChange, storyPath, colorMode, fallback } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [islandSizes, setIslandSizes] = useState<Record<number, { width: number; height: number }>>();
  const { containerRef, result, bitmapRef, failed, scale } = useStoryRaster(html, compiledCss, width, islandSizes);
  const selection = useCanvasSelection(canvasRef, bitmapRef, result);
  const { embeds, islandEls, islandRefs, targets } = useEmbedIslands(result);
  useIslandMeasurement(embeds, islandEls, scale, islandSizes, setIslandSizes);
  useStoryCapture(canvasRef, bitmapRef, result, islandEls);

  if (failed) return <>{fallback}</>;

  return (
    <Box ref={containerRef} position="relative" width="100%" aria-label="canvas-story">
      <canvas
        ref={canvasRef}
        width={(result?.width ?? width) * STORY_DPR}
        height={(result?.height ?? 0) * STORY_DPR}
        style={{ display: 'block', width: `${(result?.width ?? width) * scale}px`, height: `${(result?.height ?? 0) * scale}px`, cursor: 'text' }}
        onMouseDown={selection.onMouseDown}
        onMouseMove={selection.onMouseMove}
        onDoubleClick={selection.onDoubleClick}
        aria-label="canvas-story-surface"
      />
      <Theme
        appearance={colorMode ?? 'light'}
        position="absolute"
        inset="0"
        pointerEvents="none"
        background="transparent"
        aria-label="canvas-story-islands"
        css={{
          // Replicate the iframe environment the DOM path renders embeds in:
          // next/font CSS vars are NOT defined inside the iframe, so theme font
          // tokens fall back there. Concrete stacks (see ISLAND_FONT_VARS).
          ...ISLAND_FONT_VARS,
          // Base embed CSS that AgentHtml injects into the iframe (mirror-app-styles).
          '& .mx-chart-fill': { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
        }}
      >
        {embeds.map(e => (
          <Box
            key={e.index}
            ref={islandRefs.get(e.index)}
            pointerEvents="auto"
            style={ISLAND_FONT_VARS}
            position="absolute"
            left={`${e.x * scale}px`}
            top={`${e.y * scale}px`}
            width={`${e.w * scale}px`}
            height={e.kind === 'number-inline' || e.kind === 'param' ? undefined : `${e.h * scale}px`}
            minHeight={`${e.h * scale}px`}
            aria-label={`canvas-story-embed-${e.kind}`}
          />
        ))}
        {targets.count ? (
          <StoryEmbeds
            doc={document}
            targets={targets.charts}
            inlineTargets={targets.inline}
            numberTargets={targets.numbers}
            paramTargets={targets.params}
            readOnly={readOnly}
            editable={false}
            paramValues={paramValues}
            onParamValuesChange={onParamValuesChange}
            storyPath={storyPath}
            colorMode={colorMode}
          />
        ) : null}
      </Theme>
    </Box>
  );
}
