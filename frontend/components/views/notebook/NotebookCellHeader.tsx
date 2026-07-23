'use client';

/**
 * Single-row toolbar chrome shared by notebook cells: a collapse toggle, a
 * cell-type indicator (SQL/Text), a compact name field, optional cell-specific
 * controls in two slots (middle / trailing — e.g. the SQL/GUI/Viz tabs or the
 * Lexical toolbar, and the DB selector), and delete. Everything lives on ONE
 * level so cells stay dense.
 *
 * When COLLAPSED the controls (middle/trailing) are hidden — just the type
 * indicator + name show, so a folded cell reads as a quiet labelled strip.
 * Inserting new cells is handled by hover zones around the cell (CellInsertZone),
 * Jupyter/Colab style — not from this toolbar.
 */
import type { ReactNode } from 'react';
import { LuChevronDown, LuChevronRight, LuTrash2, LuDatabase, LuFileText } from 'react-icons/lu';
import { Input } from '@/components/kit/input';
import { cn } from '@/components/kit/cn';

interface NotebookCellHeaderProps {
  cellType: 'sql' | 'text';
  collapsed: boolean;
  onToggleCollapse: () => void;
  name: string;
  onNameChange: (name: string) => void;
  onRemove: () => void;
  readOnly?: boolean;
  middle?: ReactNode;
  trailing?: ReactNode;
}

function Divider() {
  return <div className="my-1.5 w-px shrink-0 self-stretch bg-border/60 opacity-60" />;
}

export default function NotebookCellHeader({
  cellType, collapsed, onToggleCollapse, name, onNameChange, onRemove, readOnly = false, middle, trailing,
}: NotebookCellHeaderProps) {
  const TypeIcon = cellType === 'sql' ? LuDatabase : LuFileText;
  const typeColor = cellType === 'sql' ? '#16a085' : '#9b59b6';

  const nameInput = (
    <Input
      aria-label="Cell name"
      placeholder="Untitled"
      value={name}
      onChange={(e) => onNameChange(e.target.value)}
      disabled={readOnly}
      // Collapsed: fill the row so the full name is visible. Expanded: a fixed
      // field on the right so it doesn't crowd the toolbar.
      className={cn(
        'h-6 rounded-none border-x-0 border-t-0 border-b border-transparent bg-transparent px-1 shadow-none',
        'font-mono text-xs font-medium tracking-[-0.01em] md:text-xs',
        'focus-visible:border-border focus-visible:text-foreground focus-visible:ring-0',
        collapsed
          ? 'w-auto min-w-[60px] flex-1 shrink text-left text-foreground'
          : 'w-[160px] shrink-0 text-right text-muted-foreground',
      )}
    />
  );

  return (
    <div
      className={cn(
        'flex min-h-[36px] items-center gap-2 px-2 py-1 bg-muted/50',
        !collapsed && 'border-b border-border/60',
      )}
    >
      {/* Left: collapse + type indicator */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          aria-label={collapsed ? 'Expand cell' : 'Collapse cell'}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
          onClick={onToggleCollapse}
        >
          {collapsed ? <LuChevronRight /> : <LuChevronDown />}
        </button>
        <TypeIcon
          size={14}
          className="shrink-0"
          style={{ color: typeColor }}
          aria-label={cellType === 'sql' ? 'SQL cell' : 'Text cell'}
        />
      </div>

      {collapsed ? (
        // Collapsed: the name fills the row (fully visible).
        nameInput
      ) : (
        // Expanded: toolbar leads on the LEFT; name sits on the right.
        <>
          <div className="flex min-w-0 shrink-0 items-center overflow-x-auto">
            {middle}
          </div>
          <div className="min-w-2 flex-1" />
          {nameInput}
          {trailing && (
            <>
              <Divider />
              <div className="shrink-0">{trailing}</div>
            </>
          )}
        </>
      )}

      <Divider />

      <button
        type="button"
        aria-label="Delete cell"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-[#c0392b] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5"
        disabled={readOnly}
        onClick={onRemove}
      >
        <LuTrash2 />
      </button>
    </div>
  );
}
