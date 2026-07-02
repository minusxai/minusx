'use client';

/**
 * StoryMoveHandle — a drag grip on a story embed placeholder in edit mode. Dragging it reorders the
 * widget's whole CARD to any flow position across the story (stories are a flow document — "move" is
 * reorder, not free x/y). While dragging, a live insertion line shows where the card will land; on
 * release it's spliced into that gap and the story is marked dirty. Drops are refused inside packed
 * grid/flex/table containers (which would re-break the widget's px-resize contract).
 *
 * Rendered by StoryEmbeds as a direct child of the placeholder `target` (a sibling of the resize
 * handles). All imperative DOM writes live in story-reorder.ts helpers so this component never mutates
 * its props (react-hooks/immutability).
 */
import { useRef } from 'react';
import {
  movableUnit,
  collectDropSlots,
  chooseDropSlot,
  applyDrop,
  positionDropIndicator,
  removeDropIndicator,
  type DropSlot,
} from '@/lib/html/story-reorder';

const GRIP = 22;

interface Props {
  /** The placeholder element that gets reordered. */
  target: HTMLElement;
  /** Fired after a move commits, so the caller can mark the story dirty. */
  onCommit: () => void;
}

export default function StoryMoveHandle({ target, onCommit }: Props) {
  // The card to move (target or a wrapping plate) + the story canvas, captured at drag start.
  const drag = useRef<{ unit: HTMLElement; canvas: HTMLElement } | null>(null);

  const slotFor = (clientY: number): DropSlot | null => {
    if (!drag.current) return null;
    return chooseDropSlot(collectDropSlots(drag.current.canvas, drag.current.unit), clientY);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const canvas = target.ownerDocument.body;
    drag.current = { unit: movableUnit(target, canvas), canvas };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const slot = slotFor(e.clientY);
    if (slot) positionDropIndicator(drag.current.canvas, slot);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const slot = slotFor(e.clientY);
    removeDropIndicator(target.ownerDocument);
    if (slot) applyDrop(drag.current.unit, slot);
    drag.current = null;
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
