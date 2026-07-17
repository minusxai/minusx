'use client';

import { useCallback, useEffect, useRef } from 'react';
import { locatePoint, selectionBands, selectionText, wordAt, type RunSelection } from '@/lib/canvas-story/selection';
import { STORY_DPR, type StoryRasterResult } from '@/lib/canvas-story/types';

/**
 * Canvas text selection: drag to select, double-click for a word, cmd/ctrl+C to copy.
 *
 * Owns the canvas compositor too — the surface is always drawn as (story bitmap +
 * translucent highlight bands), so a redraw with no selection is just the bitmap.
 * The highlight is a translucent accent wash (the text stays visible beneath it);
 * geometry comes from the pure selection model in selection.ts.
 */
const SELECTION_FILL = 'rgba(22,160,133,0.30)'; // accent.teal wash, glyphs legible underneath

export interface CanvasSelectionHandlers {
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  /** Repaint the surface (bitmap + selection) — e.g. after the editor mask clears. */
  redraw: () => void;
}

export function useCanvasSelection(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  bitmapRef: React.RefObject<ImageBitmap | null>,
  result: StoryRasterResult | null,
): CanvasSelectionHandlers {
  const selRef = useRef<RunSelection | null>(null);
  const draggingRef = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const bitmap = bitmapRef.current;
    if (!canvas || !bitmap || !result) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    if (!selRef.current) return;
    ctx.fillStyle = SELECTION_FILL;
    for (const b of selectionBands(result.runs, selRef.current)) {
      ctx.fillRect(b.x * STORY_DPR, b.y * STORY_DPR, b.w * STORY_DPR, b.h * STORY_DPR);
    }
  }, [canvasRef, bitmapRef, result]);

  useEffect(() => { draw(); }, [draw]);

  /** Pointer position in layout px (the runs' coordinate space). */
  const toStoryPx = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const k = (result?.width ?? rect.width) / rect.width;
    return [(e.clientX - rect.left) * k, (e.clientY - rect.top) * k] as const;
  }, [canvasRef, result]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!result) return;
    const [x, y] = toStoryPx(e);
    const p = locatePoint(result.runs, x, y);
    if (!p) return;
    selRef.current = { a: p, b: p };
    draggingRef.current = true;
    draw();
  }, [result, toStoryPx, draw]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current || !selRef.current || !result) return;
    const [x, y] = toStoryPx(e);
    const p = locatePoint(result.runs, x, y);
    if (p) { selRef.current = { ...selRef.current, b: p }; draw(); }
  }, [result, toStoryPx, draw]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!result) return;
    const [x, y] = toStoryPx(e);
    const p = locatePoint(result.runs, x, y);
    const word = p && wordAt(result.runs, p);
    if (!word) return;
    selRef.current = word;
    draw();
  }, [result, toStoryPx, draw]);

  useEffect(() => {
    const onUp = () => { draggingRef.current = false; };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selRef.current && result) {
        const text = selectionText(result.runs, selRef.current);
        if (text) {
          e.preventDefault();
          void navigator.clipboard.writeText(text);
        }
      }
    };
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mouseup', onUp); window.removeEventListener('keydown', onKey); };
  }, [result]);

  return { onMouseDown, onMouseMove, onDoubleClick, redraw: draw };
}
