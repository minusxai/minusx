'use client';

// ─── Inline SQL Dropdown Widget ──────────────────────────────────────────────
// Rendered when parameter.source.type === 'sql'. Executes the inline query and
// shows results as a combobox dropdown.

import React, { useState, useMemo, useRef } from 'react';
import { LuTriangleAlert } from 'react-icons/lu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/kit/popover';
import type { SqlParameterSource } from '@/lib/validation/atlas-schemas';
import { useQueryResult } from '@/lib/hooks/file-state-hooks';
import { ROW_H, formatNumStr } from './paramInputShared';

interface InlineSqlDropdownWidgetProps {
  source: SqlParameterSource;
  paramType: 'text' | 'number';
  currentValue: string | number | undefined;
  paramName: string;
  database?: string;
  /** Hosting file path, used by public-share query authorization. */
  filePath?: string;
  onChange: (value: string | number) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
  /** Literal story-authored input styling. */
  inputStyle?: React.CSSProperties;
}

export function InlineSqlDropdownWidget({ source, paramType, currentValue, paramName, database, filePath, onChange, onSubmit, inputStyle }: InlineSqlDropdownWidgetProps) {
  const { data, loading, error } = useQueryResult(
    source.query,
    {},
    database ?? '',
    { skip: !source.query, filePath }
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

  // The kit Popover is deliberately un-portaled and receives the story surface's
  // foreignObject positioning fix. Keeping this in the shared widget means stories
  // only describe the query; they never need to position or size its option menu.
  const [open, setOpen] = useState(false);
  const listboxId = `param-sql-list-${paramName}`;

  // Closing without a selection restores the last committed value (old combobox parity).
  const closeAndRestore = () => {
    setOpen(false);
    setInputDisplay(committedRef.current);
    setFilterText('');
  };

  const commit = (raw: string) => {
    committedRef.current = raw;
    setInputDisplay(raw);
    setFilterText('');
    const final: string | number = paramType === 'number' ? (parseFloat(raw) || 0) : raw;
    onChange(final);
  };

  return (
    <div className="flex items-center gap-1">
      {(error || (values !== null && values.length === 0 && !loading)) && (
        <TooltipProvider>
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

      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else closeAndRestore();
        }}
      >
        <PopoverTrigger asChild>
          <input
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-label={`param ${paramName}`}
            placeholder={paramType === 'number' ? '0 or select…' : 'type or select…'}
            value={inputDisplay}
            className="min-w-[100px] border-none bg-transparent px-2 font-mono text-xs outline-none placeholder:text-muted-foreground"
            style={{ height: ROW_H, ...inputStyle }}
            onChange={(e) => {
              setInputDisplay(e.target.value);
              setFilterText(e.target.value);
              if (!open) setOpen(true);
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
        </PopoverTrigger>
        <PopoverContent
          id={listboxId}
          role="listbox"
          align="start"
          side="bottom"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="max-h-[min(240px,var(--radix-popover-content-available-height))] w-max min-w-[var(--radix-popover-trigger-width)] max-w-[min(420px,calc(100vw-16px))] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
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
                title={item}
                className="cursor-pointer whitespace-normal break-words rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
