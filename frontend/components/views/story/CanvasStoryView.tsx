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
import { useEffect, useMemo, useRef, useState } from 'react';
import StoryEmbeds from '@/components/views/shared/StoryEmbeds';
import { storyDpr } from '@/lib/canvas-story/types';
import { useStoryRaster } from '@/lib/canvas-story/use-story-raster';
import { useCanvasSelection } from '@/lib/canvas-story/use-canvas-selection';
import { useEmbedIslands } from '@/lib/canvas-story/use-embed-islands';
import { useIslandMeasurement } from '@/lib/canvas-story/use-island-measurement';
import { useBlockEditor, type ActiveBlockEdit } from '@/lib/canvas-story/use-block-editor';
import { extractStoryStyles } from '@/lib/canvas-story/edit-blocks';
import { useStoryCapture } from '@/lib/canvas-story/use-story-capture';
import { CanvasRenderContext } from '@/lib/canvas-story/canvas-render-context';

export interface CanvasStoryViewProps {
  html: string;
  compiledCss?: string | null;
  width: number;
  readOnly: boolean;
  paramValues?: Record<string, unknown>;
  onParamValuesChange?: (values: Record<string, unknown>) => void;
  storyPath?: string;
  colorMode?: 'light' | 'dark';
  /** Edit mode: click a text block to edit it in place (canvas text editing). */
  editable?: boolean;
  /** Emits the updated story HTML after a block edit commits (same contract as AgentHtml). */
  onStoryChange?: (html: string) => void;
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
  const { html, compiledCss, width, readOnly, paramValues, onParamValuesChange, storyPath, colorMode, editable = false, onStoryChange, fallback } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [islandSizes, setIslandSizes] = useState<Record<number, { width: number; height: number }>>();
  const { containerRef, result, bitmapRef, failed, scale } = useStoryRaster(html, compiledCss, width, islandSizes);
  const selection = useCanvasSelection(canvasRef, bitmapRef, result);
  const editor = useBlockEditor(editable, result, html, onStoryChange);
  // Edit mode: a click opens the block editor (native caret/IME live in the overlay);
  // read mode keeps drag selection. Coordinates map to layout px like toStoryPx.
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (!editable) { selection.onMouseDown(e); return; }
    // preventDefault: the mousedown's default focus change would blur the editor
    // the moment it opens (the same click's tail commits/closes it otherwise).
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const k = (result?.width ?? rect.width) / rect.width;
    editor.openAt((e.clientX - rect.left) * k, (e.clientY - rect.top) * k);
  };
  const { embeds, islandEls, islandRefs, targets } = useEmbedIslands(result);
  useIslandMeasurement(embeds, islandEls, scale, islandSizes, setIslandSizes);
  useStoryCapture(canvasRef, bitmapRef, result, islandEls);
  // The story's own <style> CSS (custom classes, CSS variables like --navy) — the
  // editor overlay needs it alongside compiledCss or blocks change color on edit.
  const storyStyles = useMemo(() => (editable ? extractStoryStyles(html) : ''), [editable, html]);

  // While a block is being edited, mask its region on the raster (sampled bg color)
  // so the original text doesn't show through behind the overlay editor.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (!editor.active) { selection.redraw(); return; }
    const b = editor.active.box;
    const dpr = result?.dpr ?? storyDpr();
    const sx = Math.max(0, Math.round((b.x - 8) * dpr));
    const sy = Math.max(0, Math.round((b.y + 2) * dpr));
    let fill = colorMode === 'dark' ? '#111827' : '#ffffff';
    try {
      const px = ctx.getImageData(sx, sy, 1, 1).data;
      fill = `rgb(${px[0]},${px[1]},${px[2]})`;
    } catch { /* tainted/edge — fall back to theme bg */ }
    ctx.fillStyle = fill;
    ctx.fillRect(b.x * dpr, b.y * dpr, b.w * dpr, b.h * dpr);
    // `result` IS a dependency: committing one block re-rasters and repaints the whole
    // canvas, which would otherwise wipe the mask under a still-open editor (ghost text).
    // This effect is declared after the selection hook's repaint, so mask lands on top.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw identity churns with result; mask depends on active block + repaints
  }, [editor.active, colorMode, result]);

  if (failed) return <>{fallback}</>;

  return (
    <Box ref={containerRef} position="relative" width="100%" aria-label="canvas-story">
      <canvas
        ref={canvasRef}
        width={(result?.width ?? width) * (result?.dpr ?? storyDpr())}
        height={(result?.height ?? 0) * (result?.dpr ?? storyDpr())}
        style={{ display: 'block', width: `${(result?.width ?? width) * scale}px`, height: `${(result?.height ?? 0) * scale}px`, cursor: 'text' }}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={editable ? undefined : selection.onMouseMove}
        onDoubleClick={editable ? undefined : selection.onDoubleClick}
        aria-label="canvas-story-surface"
      />
      <CanvasRenderContext.Provider value={true}>
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
      </CanvasRenderContext.Provider>
      {editor.active && (
        <BlockEditorOverlay
          key={`${editor.active.ref.tag}:${editor.active.ref.occurrence}:${editor.active.ref.text.slice(0, 24)}`}
          active={editor.active}
          scale={scale}
          layoutWidth={result?.width ?? width}
          compiledCss={compiledCss ?? ''}
          storyStyles={storyStyles}
          onCommit={editor.commit}
          onCancel={editor.cancel}
        />
      )}
    </Box>
  );
}

/**
 * The in-place block editor: an absolutely-positioned host over the block's box whose
 * SHADOW ROOT carries the story's compiled CSS + root class context, so the block
 * renders with its real styles while being a native contenteditable (caret, IME,
 * shortcuts all come from the browser). Commit on blur / cmd+Enter; Escape cancels.
 */
function BlockEditorOverlay({ active, scale, layoutWidth, compiledCss, storyStyles, onCommit, onCancel }: {
  active: ActiveBlockEdit;
  scale: number;
  /** Story layout width — the shadow wrapper must be this wide so the story's
   *  @container variants (headline sizes etc.) resolve as they do in the raster. */
  layoutWidth: number;
  compiledCss: string;
  /** The story's own <style> CSS — custom classes + CSS variables. */
  storyStyles: string;
  onCommit: (outerHtml: string) => void;
  onCancel: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    // Rebuild the block's ANCESTOR CHAIN so descendant selectors, inherited props,
    // and CSS variables apply exactly as in the story — with layout neutralized so
    // the block sits at the host's origin. Ancestor inline styles come first (they
    // may define variables); the neutralizers override their layout effects.
    const NEUTRAL = 'padding:0;margin:0;border:0;background:transparent;box-shadow:none;width:auto;max-width:none;min-height:0;min-width:0;display:block';
    const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const chain = active.ancestors.length ? active.ancestors : [{ tag: 'div', className: '', style: '' }];
    const open = chain.map((a, i) => {
      const size = i === 0
        ? `width:${layoutWidth}px;transform:scale(${scale});transform-origin:0 0;`
        : '';
      return `<${a.tag} class="${escapeAttr(a.className)}" style="${escapeAttr(a.style)};${NEUTRAL};${size}">`;
    }).join('');
    const close = chain.map(a => `</${a.tag}>`).reverse().join('');
    shadow.innerHTML = `<style>${compiledCss}
${storyStyles}
:host{display:block}
#mx-edit{outline:2px solid #16a085;outline-offset:2px;min-height:1em;background:inherit}</style>` +
      `${open}<div id="mx-edit" contenteditable="true" style="width:${Math.ceil(active.box.w)}px">${active.html}</div>${close}`;
    const edit = shadow.getElementById('mx-edit') as HTMLElement | null;
    if (!edit) return;
    const block = edit.firstElementChild as HTMLElement | null;
    edit.focus();
    const sel = window.getSelection();
    if (sel && block) { const r = document.createRange(); r.selectNodeContents(block); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    const commit = () => onCommit(edit.innerHTML);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
    };
    // Click-away commits: the canvas prevents focus-stealing (so no natural blur) —
    // capture-phase mousedown outside the host is the "done editing" gesture.
    const onDocDown = (ev: MouseEvent) => { if (host && !host.contains(ev.target as Node)) commit(); };
    edit.addEventListener('blur', commit);
    edit.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDocDown, true);
    return () => { edit.removeEventListener('blur', commit); edit.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDocDown, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per active block (keyed remount)
  }, []);

  return (
    <div
      ref={hostRef}
      aria-label="canvas-story-block-editor"
      style={{
        position: 'absolute',
        left: `${active.box.x * scale}px`,
        top: `${active.box.y * scale}px`,
        width: `${active.box.w * scale}px`,
        minHeight: `${active.box.h * scale}px`,
        zIndex: 10,
      }}
    />
  );
}
