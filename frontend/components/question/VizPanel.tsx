'use client';

/**
 * VizPanel — the third column of the question surface, shown for ALL
 * questions (semantic and raw SQL alike): a slim header over the full chart
 * config (type selector + axis/config panels, supplied by the parent as
 * children). There are NO tabs here — the query itself already lives in the
 * left GUI/SQL column. The panel is a FIXED-width column (not draggable), so
 * collapsing lives on the header's own chevron rather than a resize handle.
 *
 * The panel is a SHELL: it owns no viz state. The parent (QuestionViewV2)
 * keeps every VizConfigPanel handler exactly where it already lives and
 * passes the assembled config block down as children, so adding a viz
 * setting never touches this file.
 */

import React from 'react';
import { LuChartColumn, LuChevronRight } from 'react-icons/lu';

interface VizPanelProps {
  /** Optional control rendered at the header's right edge (e.g. the Auto chart-type badge). */
  headerExtra?: React.ReactNode;
  /** Collapse the panel to its slim strip. When omitted, no collapse chevron is shown. */
  onCollapse?: () => void;
  /** The full chart config block, assembled by the parent. */
  children: React.ReactNode;
}

export function VizPanel({ headerExtra, onCollapse, children }: VizPanelProps) {
  return (
    <div aria-label="Viz panel" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted px-3 py-1.5">
        <LuChartColumn size={12} color="#16a085" />
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Viz Settings
        </span>
        {headerExtra && <div className="ml-auto">{headerExtra}</div>}
        {onCollapse && (
          <button
            type="button"
            className={`flex cursor-pointer items-center justify-center rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground ${headerExtra ? 'ml-0' : 'ml-auto'}`}
            aria-label="Collapse viz panel"
            onClick={onCollapse}
          >
            <LuChevronRight size={14} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
