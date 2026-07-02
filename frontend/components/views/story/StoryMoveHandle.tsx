'use client';

/**
 * StoryMoveHandle — a drag grip on a story embed placeholder in edit mode. Dragging it reorders the
 * widget among its flow siblings (stories are a flow document — "move" is reorder, not free x/y). While
 * dragging, a live insertion line shows where the widget will land; on release the widget is spliced
 * into that slot and the story is marked dirty.
 *
 * Rendered by StoryEmbeds as a direct child of the placeholder `target` (a sibling of the resize
 * handles). All imperative DOM writes live in story-reorder.ts helpers so this component never mutates
 * its props (react-hooks/immutability).
 */
import { useRef } from 'react';
import {
  computeDropIndex,
  reorderBlock,
  movableSiblings,
  positionDropIndicator,
  removeDropIndicator,
} from '@/lib/html/story-reorder';

const GRIP = 22;

interface Props {
  /** The placeholder element that gets reordered. */
  target: HTMLElement;
  /** Fired after a move commits, so the caller can mark the story dirty. */
  onCommit: () => void;
}

export default function StoryMoveHandle({ target, onCommit }: Props) {
  // The sibling blocks EXCLUDING the dragged widget, captured at drag start — index maps to a drop slot.
  const others = useRef<HTMLElement[] | null>(null);

  const slotFor = (clientY: number): number => {
    const rects = (others.current ?? []).map(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    return computeDropIndex(rects, clientY);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    others.current = movableSiblings(target).filter(el => el !== target);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!others.current) return;
    positionDropIndicator(target, others.current, slotFor(e.clientY));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!others.current) return;
    const slot = slotFor(e.clientY);
    removeDropIndicator(target);
    reorderBlock(target, others.current, slot);
    others.current = null;
    onCommit();
  };

  return (
    <div
      role="button"
      aria-label="Move widget"
      title="Drag to move"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'absolute',
        top: 6,
        left: 6,
        width: GRIP,
        height: GRIP,
        zIndex: 31,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--mx-accent, #3b82f6)',
        color: 'white',
        border: '1px solid white',
        borderRadius: 4,
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        cursor: 'grab',
        touchAction: 'none',
        fontSize: 12,
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      ⠿
    </div>
  );
}
