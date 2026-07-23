'use client';

// ─── Source Dropdown Widget ───────────────────────────────────────────────────
// Rendered in place of the text/number Input when parameter.source is set.

import React, { useState, useMemo } from 'react';
import { LuTriangleAlert } from 'react-icons/lu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import { QuestionContent } from '@/lib/types';
import type { QuestionParameterSource } from '@/lib/validation/atlas-schemas';
import { useFile, useQueryResult } from '@/lib/hooks/file-state-hooks';
import { ROW_H, formatNumStr } from './paramInputShared';
import { useSpreadsheetResult } from '@/lib/hooks/use-spreadsheet-result';

const TEAL = '#16a085';

interface SourceDropdownWidgetProps {
  source: QuestionParameterSource;
  paramType: 'text' | 'number';
  currentValue: string | number | undefined;
  paramName: string;
  onChange: (value: string | number) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
  /** Agent-supplied CSS for the input (story `<Param style={{…}}>`) — literal CSS, wins over defaults. */
  inputStyle?: React.CSSProperties;
}

export function SourceDropdownWidget({ source, paramType, currentValue, paramName, onChange, onSubmit, inputStyle }: SourceDropdownWidgetProps) {
  const augmented = useFile(source.id);
  const content = augmented?.fileState.content as QuestionContent | undefined | null;

  const sqlResult = useQueryResult(
    content?.query ?? '',
    (content?.parameterValues ?? {}) as Record<string, any>,
    content?.connection_name ?? '',
    { skip: !!content?.spreadsheet || !content?.query }
  );
  const spreadsheetResult = useSpreadsheetResult(content?.spreadsheet, { skip: !content?.spreadsheet });
  const { data, loading, error } = content?.spreadsheet ? spreadsheetResult : sqlResult;

  // Extract distinct values from source.column, formatted for display
  const values = useMemo<string[] | null>(() => {
    if (!data?.rows) return null;
    if (!source.column) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of data.rows) {
      const v = row[source.column];
      if (v != null) {
        const str = paramType === 'number' ? formatNumStr(String(v)) : String(v);
        if (!seen.has(str)) {
          seen.add(str);
          result.push(str);
        }
      }
    }
    // Sort: numeric order for numbers, lexicographic for text
    return paramType === 'number'
      ? result.sort((a, b) => parseFloat(a) - parseFloat(b))
      : result.sort();
  }, [data, source.column, paramType]);

  // What to show in the input — formatted current committed value
  const defaultDisplayValue = currentValue != null
    ? (paramType === 'number' ? formatNumStr(String(currentValue)) : String(currentValue))
    : '';

  // Controlled input display, owned locally so typing drives it directly. We do NOT key/remount
  // on value changes (that lost focus mid-type) and we do NOT resync from the prop in an effect:
  // for a story `<Param>`, the value only ever changes by the reader typing into THIS widget, so
  // the local state is always the source of truth. A fresh mount (story reload) re-seeds it from
  // the committed value via useState's initializer.
  const [inputDisplay, setInputDisplay] = useState(defaultDisplayValue);

  const commit = (raw: string) => {
    setInputDisplay(raw);
    const final: string | number = paramType === 'number' ? (parseFloat(raw) || 0) : raw;
    onChange(final);
  };

  const listId = `param-src-${source.id}-${source.column}`;

  return (
    <div className="flex items-center gap-1">
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

      {/*
        Native <datalist> autocomplete — NOT a floating popover. This control renders inside the
        story's SHADOW ROOT (StoryParamControl portals it there). A floating dropdown (Radix /
        floating-ui) cannot measure its anchor across the shadow boundary, so its menu — and its
        "No matches" empty state — rendered detached in a corner of the window. The browser
        positions a <datalist> itself, correctly, in any context (shadow root included), with zero
        positioning code. Explicit LIGHT colors (not theme tokens): tokens resolve against the
        host app's color mode across the shadow boundary (a dark-app token paints this black on a
        light story). `role=combobox` matches the input-with-list ARIA contract.
      */}
      <input
        list={listId}
        role="combobox"
        aria-label={`param ${paramName}`}
        placeholder={paramType === 'number' ? '0 or select…' : 'type or select…'}
        value={inputDisplay}
        className="w-full min-w-[120px] rounded-md border px-3 text-sm outline-none placeholder:text-[#6b7280]"
        style={{
          height: ROW_H,
          background: 'white',
          color: '#111827',
          borderColor: '#d1d5db',
          fontFamily: paramType === 'number' ? 'var(--font-mono, monospace)' : 'inherit',
          ...inputStyle,
        }}
        onFocus={(e) => {
          if (inputStyle?.borderColor == null) e.currentTarget.style.borderColor = TEAL;
          if (inputStyle?.boxShadow == null) e.currentTarget.style.boxShadow = `0 0 0 1px ${TEAL}`;
        }}
        onBlur={(e) => {
          if (inputStyle?.borderColor == null) e.currentTarget.style.borderColor = '#d1d5db';
          if (inputStyle?.boxShadow == null) e.currentTarget.style.boxShadow = '';
        }}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
            e.preventDefault();
            e.stopPropagation();
            const raw = e.currentTarget.value;
            commit(raw);
            if (onSubmit) {
              const final: string | number = paramType === 'number' ? (parseFloat(raw) || 0) : raw;
              onSubmit(paramName, final);
            }
          }
        }}
      />
      <datalist id={listId}>
        {(values ?? []).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </div>
  );
}
