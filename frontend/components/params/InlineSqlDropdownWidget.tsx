'use client';

// ─── Inline SQL Dropdown Widget ──────────────────────────────────────────────
// Rendered when parameter.source.type === 'sql'. Executes the inline query and
// shows results as a combobox dropdown.

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { LuTriangleAlert } from 'react-icons/lu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import type { SqlParameterSource } from '@/lib/validation/atlas-schemas';
import { useQueryResult } from '@/lib/hooks/file-state-hooks';
import { ROW_H, formatNumStr } from './paramInputShared';

interface InlineSqlDropdownWidgetProps {
  source: SqlParameterSource;
  paramType: 'text' | 'number';
  currentValue: string | number | undefined;
  paramName: string;
  database?: string;
  onChange: (value: string | number) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
}

export function InlineSqlDropdownWidget({ source, paramType, currentValue, paramName, database, onChange, onSubmit }: InlineSqlDropdownWidgetProps) {
  const { data, loading, error } = useQueryResult(
    source.query,
    {},
    database ?? '',
    { skip: !source.query }
  );

  // Extract distinct values from the first column
  const values = useMemo<string[] | null>(() => {
    if (!data?.rows || !data?.columns?.length) return null;
    const firstCol = data.columns[0];
    const col = typeof firstCol === 'string' ? firstCol : firstCol.name;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of data.rows) {
      const v = row[col];
      if (v != null) {
        const str = paramType === 'number' ? formatNumStr(String(v)) : String(v);
        if (!seen.has(str)) {
          seen.add(str);
          result.push(str);
        }
      }
    }
    return paramType === 'number'
      ? result.sort((a, b) => parseFloat(a) - parseFloat(b))
      : result.sort();
  }, [data, paramType]);

  const [filterText, setFilterText] = useState('');

  // Prefix matches rank above contains matches (typeahead parity with the old combobox).
  const filteredItems = useMemo(() => {
    const lower = filterText.toLowerCase();
    const all = values ?? [];
    if (!lower) return all;
    const prefix: string[] = [];
    const rest: string[] = [];
    for (const v of all) {
      if (v.toLowerCase().startsWith(lower)) prefix.push(v);
      else if (v.toLowerCase().includes(lower)) rest.push(v);
    }
    return [...prefix, ...rest];
  }, [values, filterText]);

  const defaultDisplayValue = currentValue != null
    ? (paramType === 'number' ? formatNumStr(String(currentValue)) : String(currentValue))
    : '';

  const [inputDisplay, setInputDisplay] = useState(defaultDisplayValue);
  const committedRef = useRef(defaultDisplayValue);

  // Dropdown open state + fixed-position anchor (position:fixed escapes the
  // param row's overflow clipping without a portal — kit convention).
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `param-sql-list-${paramName}`;

  const openList = () => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  // Closing without a selection restores the last committed value (old combobox parity).
  const closeAndRestore = () => {
    setOpen(false);
    setInputDisplay(committedRef.current);
    setFilterText('');
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      closeAndRestore();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const commit = (raw: string) => {
    committedRef.current = raw;
    setInputDisplay(raw);
    setFilterText('');
    const final: string | number = paramType === 'number' ? (parseFloat(raw) || 0) : raw;
    onChange(final);
  };

  return (
    <div className="flex items-center gap-1" ref={rootRef}>
      {(error || (values !== null && values.length === 0 && !loading)) && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild={false} className="flex items-center text-[#f39c12] outline-none">
              <LuTriangleAlert size={14} />
            </TooltipTrigger>
            <TooltipContent>{error ? 'Could not load suggestions' : 'No suggestions found'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {loading && values === null && (
        <div aria-hidden="true" className="size-3 shrink-0 animate-spin rounded-full border-2 border-[#16a085]/25 border-t-[#16a085]" />
      )}

      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={`param ${paramName}`}
        placeholder={paramType === 'number' ? '0 or select…' : 'type or select…'}
        value={inputDisplay}
        className="min-w-[100px] border-none bg-transparent px-2 font-mono text-xs outline-none placeholder:text-muted-foreground"
        style={{ height: ROW_H }}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => {
          setInputDisplay(e.target.value);
          setFilterText(e.target.value);
          if (!open) openList();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            closeAndRestore();
            return;
          }
          if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
            e.preventDefault();
            e.stopPropagation();
            const raw = e.currentTarget.value;
            commit(raw);
            setOpen(false);
            if (onSubmit) {
              const final: string | number = paramType === 'number'
                ? (parseFloat(raw) || 0)
                : raw;
              onSubmit(paramName, final);
            }
          }
        }}
      />
      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="fixed z-50 max-h-[240px] min-w-[160px] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ top: pos.top, left: pos.left }}
        >
          {loading && values === null ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
          ) : filteredItems.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches</div>
          ) : (
            filteredItems.map(item => (
              <div
                key={item}
                role="option"
                aria-selected={item === inputDisplay}
                className="cursor-pointer rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                // preventDefault keeps focus in the input so the click lands before any blur.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  commit(item);
                  setOpen(false);
                }}
              >
                {item}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
