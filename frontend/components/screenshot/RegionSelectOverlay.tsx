'use client';

/**
 * RegionSelectOverlay — a full-viewport drag-select layer. The user drags a rectangle;
 * on release it calls onSelect(rect) with viewport (client) coordinates. Esc or a too-small
 * drag (a click) cancels. Tagged with `data-region-select-overlay` so the screenshot capture
 * filter can exclude the overlay itself from the captured image.
 */
import { useEffect, useState, type CSSProperties } from 'react';

export interface SelectionRect { x: number; y: number; width: number; height: number }
interface Point { x: number; y: number }

const MIN_SIZE = 8; // px — smaller than this is treated as a click → cancel

function rectFrom(a: Point, b: Point): SelectionRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export default function RegionSelectOverlay({ onSelect, onCancel }: {
  onSelect: (rect: SelectionRect) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const sel = start && current ? rectFrom(start, current) : null;

  const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2147483646, cursor: 'crosshair',
    background: sel ? 'transparent' : 'rgba(0,0,0,0.15)', userSelect: 'none', touchAction: 'none',
  };

  return (
    <div
      data-region-select-overlay=""
      aria-label="Select a region to send to the agent"
      style={overlayStyle}
      onMouseDown={(e) => { setStart({ x: e.clientX, y: e.clientY }); setCurrent({ x: e.clientX, y: e.clientY }); }}
      onMouseMove={(e) => { if (start) setCurrent({ x: e.clientX, y: e.clientY }); }}
      onMouseUp={(e) => {
        if (!start) return;
        const rect = rectFrom(start, { x: e.clientX, y: e.clientY });
        setStart(null); setCurrent(null);
        if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) onSelect(rect);
        else onCancel();
      }}
    >
      {!sel && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(17,24,39,0.92)', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 13, pointerEvents: 'none' }}>
          Drag to select a region · Esc to cancel
        </div>
      )}
      {sel && (
        <div
          aria-label="selection rectangle"
          style={{
            position: 'fixed', left: sel.x, top: sel.y, width: sel.width, height: sel.height,
            border: '2px solid #3b82f6', background: 'rgba(59,130,246,0.12)',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)', pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
