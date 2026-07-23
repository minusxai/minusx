'use client';

/**
 * Jupyter/Colab-style insert affordance between cells (and above the first /
 * below the last). It shows a faint divider with a "+" at rest; on hover the
 * divider highlights and "+ SQL" / "+ Text" buttons appear to insert a new cell
 * at this position. Hover is tracked in local state.
 */
import { useState } from 'react';
import { LuPlus } from 'react-icons/lu';

interface CellInsertZoneProps {
  onInsert: (type: 'sql' | 'text') => void;
  readOnly?: boolean;
}

const INSERT_BTN = 'flex h-5 items-center gap-1 rounded-md border px-2 text-[10px] font-medium transition-colors';

export default function CellInsertZone({ onInsert, readOnly = false }: CellInsertZoneProps) {
  const [hovered, setHovered] = useState(false);
  if (readOnly) return null;

  return (
    <div
      role="group"
      aria-label="Insert cell"
      className="relative z-[1] flex h-[26px] items-center justify-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Divider line */}
      <div
        className="absolute left-2 right-2 top-1/2 h-px transition-all duration-100"
        style={{ background: hovered ? '#16a085' : 'var(--border)', opacity: hovered ? 0.6 : 0.5 }}
      />
      {/* Affordance: a small "+" at rest, expanding to insert buttons on hover */}
      <div className="relative flex items-center gap-1 bg-background px-1 transition-all duration-100">
        {hovered ? (
          <>
            <button
              type="button"
              aria-label="Insert SQL cell"
              className={`${INSERT_BTN} border-[#16a085] text-[#16a085] hover:bg-[color-mix(in_srgb,#16a085_10%,transparent)]`}
              onClick={() => onInsert('sql')}
            >
              <LuPlus size={10} /> SQL
            </button>
            <button
              type="button"
              aria-label="Insert text cell"
              className={`${INSERT_BTN} border-border text-foreground hover:bg-muted`}
              onClick={() => onInsert('text')}
            >
              <LuPlus size={10} /> Text
            </button>
          </>
        ) : (
          <div className="flex size-[18px] items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
            <LuPlus size={11} />
          </div>
        )}
      </div>
    </div>
  );
}
