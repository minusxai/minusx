import React from 'react';
import { MentionItem } from '@/lib/data/completions/types';
import { COLUMN_MENTION_METADATA } from '@/lib/ui/file-metadata';
import { ColumnInfo } from './mentions-plugin-utils';

interface MentionSubmenuProps {
  table: MentionItem;
  items: ColumnInfo[];
  inSubmenu: boolean;
  columnIndex: number;
  onHoverItem: (index: number) => void;
  onSelectItem: (column: ColumnInfo) => void;
}

// Amethyst purple — the column-mention accent (ACCENT_HEX.secondary).
const ColumnIcon = COLUMN_MENTION_METADATA.icon;

/** Column drill-down submenu for the highlighted table. */
export function MentionSubmenu({ table, items, inSubmenu, columnIndex, onHoverItem, onSelectItem }: MentionSubmenuProps) {
  return (
    <div
      className="max-h-[360px] max-w-[300px] min-w-[210px] overflow-hidden rounded-lg border bg-popover shadow-lg"
      style={{
        borderColor: inSubmenu ? COLUMN_MENTION_METADATA.color : 'var(--border)',
        fontFamily: 'var(--font-jetbrains-mono), monospace',
      }}
    >
      <div
        className="border-b border-border px-3 py-2"
        style={{ background: 'color-mix(in srgb, var(--muted) 50%, transparent)' }}
      >
        <div className="truncate text-xs font-bold tracking-[0] text-muted-foreground uppercase">
          {table.name}
        </div>
      </div>
      <div className="max-h-[312px] overflow-y-auto">
        <div className="flex flex-col items-stretch">
          {items.map((column, i) => (
            <div
              key={`${column.name}-${i}`}
              aria-label={`Insert column ${column.name}`}
              className={`flex cursor-pointer items-center justify-between gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted ${
                inSubmenu && i === columnIndex ? 'bg-muted' : 'bg-transparent'
              }`}
              onMouseEnter={() => onHoverItem(i)}
              onClick={() => onSelectItem(column)}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <ColumnIcon className="size-3 shrink-0" style={{ color: COLUMN_MENTION_METADATA.color }} />
                <span className="truncate text-sm font-semibold text-foreground">{column.name}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {column.type}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
