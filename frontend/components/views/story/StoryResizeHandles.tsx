'use client';

/**
 * StoryResizeHandles — 8 drag points (4 corners + 4 side-midpoints) overlaid on a story embed
 * placeholder in edit mode. Rendered by StoryEmbeds INSIDE the story iframe's nested React root, as a
 * direct child of the placeholder `target` (NOT inside the chart's `overflow:hidden` Box, or the
 * edge-hugging handles would be clipped).
 *
 * Stories are a flow document, so the box is top-left anchored: every handle only changes
 * width/height (see resizeDelta). Live drag updates the placeholder's inline size for immediate
 * feedback; on release `applyEmbedResize` writes the size into the `data-mx-osz` snapshot so it
 * survives serialize, and `onCommit` marks the story dirty.
 */
import { useEffect, useRef } from 'react';
import { applyEmbedResize, previewEmbedSize, ensurePositioned, resizeDelta, type ResizeDir } from '@/lib/html/story-resize';

const HANDLE = 10; // px hit area
const OFF = -(HANDLE / 2);
const MID = `calc(50% - ${HANDLE / 2}px)`;

const HANDLES: { dir: ResizeDir; pos: React.CSSProperties; cursor: string }[] = [
  { dir: 'nw', pos: { top: OFF, left: OFF }, cursor: 'nwse-resize' },
  { dir: 'n', pos: { top: OFF, left: MID }, cursor: 'ns-resize' },
  { dir: 'ne', pos: { top: OFF, right: OFF }, cursor: 'nesw-resize' },
  { dir: 'e', pos: { top: MID, right: OFF }, cursor: 'ew-resize' },
  { dir: 'se', pos: { bottom: OFF, right: OFF }, cursor: 'nwse-resize' },
  { dir: 's', pos: { bottom: OFF, left: MID }, cursor: 'ns-resize' },
  { dir: 'sw', pos: { bottom: OFF, left: OFF }, cursor: 'nesw-resize' },
  { dir: 'w', pos: { top: MID, left: OFF }, cursor: 'ew-resize' },
];

interface Props {
  /** The placeholder element (carries the inline size); handles position against it. */
  target: HTMLElement;
  /** Fired after a resize commits, so the caller can mark the story dirty. */
  onCommit: () => void;
}

export default function StoryResizeHandles({ target, onCommit }: Props) {
  const drag = useRef<{ dir: ResizeDir; startX: number; startY: number; startW: number; startH: number } | null>(null);

  // Give the placeholder a positioning context for the absolute handles (edit-time-only; serialize
  // discards the live style). All imperative DOM writes live in story-resize.ts helpers.
  useEffect(() => ensurePositioned(target), [target]);

  const onPointerDown = (dir: ResizeDir) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dir, startX: e.clientX, startY: e.clientY, startW: target.offsetWidth, startH: target.offsetHeight };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { width, height } = resizeDelta(d.dir, d.startW, d.startH, e.clientX - d.startX, e.clientY - d.startY);
    previewEmbedSize(target, width, height);
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    applyEmbedResize(target, target.offsetWidth, target.offsetHeight);
    onCommit();
  };

  return (
    <>
      {HANDLES.map(h => (
        <div
          key={h.dir}
          role="slider"
          aria-label={`Resize widget ${h.dir}`}
          onPointerDown={onPointerDown(h.dir)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            position: 'absolute',
            width: HANDLE,
            height: HANDLE,
            zIndex: 30,
            background: 'var(--mx-accent, #3b82f6)',
            border: '1px solid white',
            borderRadius: 2,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
            cursor: h.cursor,
            touchAction: 'none',
            ...h.pos,
          }}
        />
      ))}
    </>
  );
}
