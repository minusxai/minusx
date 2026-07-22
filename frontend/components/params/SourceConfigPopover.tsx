'use client';

// ─── Source Config Popover ────────────────────────────────────────────────────
// Settings gear that opens a popover to configure parameter.source.

import React, { useState, useMemo } from 'react';
import { LuChevronDown, LuSettings2 } from 'react-icons/lu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/kit/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/kit/dropdown-menu';
import { Button } from '@/components/kit/button';
import { Input } from '@/components/kit/input';
import { QuestionParameter } from '@/lib/types';
import type { SqlParameterSource } from '@/lib/validation/atlas-schemas';
import { getTypeColor, getTypeIcon } from '@/lib/sql/param-type-display';
import { generateLabel } from '@/lib/sql/sql-params';
import { useInferredColumns } from '@/components/query-value-selector';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import FileSearchSelect from '../shared/FileSearchSelect';
import { ROW_H } from './paramInputShared';

// Numeric SQL type patterns (sqlglot output)
const NUMERIC_TYPE_RE = /^(int|integer|bigint|smallint|tinyint|float|double|decimal|numeric|number|real|int2|int4|int8|uint|ubigint|float4|float8|hugeint)/i;

function isNumericType(type: string): boolean {
  return NUMERIC_TYPE_RE.test(type.trim());
}

// getTypeColor returns concrete hexes (kit/Tailwind stack).
const typeHex = (type: 'text' | 'number' | 'date'): string => getTypeColor(type);
const TEAL = '#16a085';
const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const SECTION_TITLE = 'mb-1.5 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground';
const PILL_BASE = 'flex items-center rounded-sm border px-2.5 py-1 font-mono text-xs font-semibold transition-colors duration-100';

interface SourceConfigPopoverProps {
  parameter: QuestionParameter;
  onParameterChange: (updated: QuestionParameter) => void;
  onTypeChange?: (type: 'text' | 'number' | 'date') => void;
  disableTypeChange?: boolean;
}

export function SourceConfigPopover({ parameter, onParameterChange, onTypeChange, disableTypeChange }: SourceConfigPopoverProps) {
  const [open, setOpen] = useState(false);

  // Local mode state tracks the toggle, even before config is complete.
  const isFromQuestion = parameter.source?.type === 'question';
  const isFromSql = parameter.source?.type === 'sql';
  const [mode, setMode] = useState<'manual' | 'question' | 'sql'>(
    isFromSql ? 'sql' : isFromQuestion ? 'question' : 'manual'
  );
  const [sqlQuery, setSqlQuery] = useState(isFromSql ? (parameter.source as SqlParameterSource).query : '');

  const sourceQuestionId = parameter.source?.type === 'question' ? parameter.source.id : null;

  const { files: questionFiles } = useFilesByCriteria({ criteria: { type: 'question' }, partial: true });
  const questionList = useMemo(
    () => questionFiles.map(f => ({ id: f.id, name: f.name || String(f.id) })),
    [questionFiles]
  );


  // Local draft state for question source (not committed until Apply)
  const [draftQuestionId, setDraftQuestionId] = useState<number | null>(sourceQuestionId);
  const [draftColumn, setDraftColumn] = useState(parameter.source?.type === 'question' ? parameter.source.column : '');

  // Columns for the drafted question — shared inference (query-value-selector).
  const activeQuestionId = draftQuestionId ?? sourceQuestionId;
  const { columns, loading: loadingCols } = useInferredColumns(
    open && activeQuestionId ? { kind: 'question', questionId: activeQuestionId } : null,
  );

  const filteredColumns = useMemo(() => {
    if (parameter.type === 'number') return columns.filter(c => isNumericType(c.type));
    return columns;
  }, [columns, parameter.type]);

  const handleModeChange = (newMode: 'manual' | 'question' | 'sql') => {
    setMode(newMode);
    if (newMode === 'manual') {
      onParameterChange({ ...parameter, source: null });
      setSqlQuery('');
      setDraftQuestionId(null);
      setDraftColumn('');
    } else if (newMode === 'sql') {
      setDraftQuestionId(null);
      setDraftColumn('');
    } else if (newMode === 'question') {
      setSqlQuery('');
    }
  };

  const handleQuestionSelect = (id: number) => {
    setDraftQuestionId(id);
    setDraftColumn('');
  };

  const handleColumnSelect = (column: string) => {
    setDraftColumn(column);
  };

  // Can we apply?
  const canApply =
    (mode === 'question' && !!draftQuestionId && !!draftColumn) ||
    (mode === 'sql' && !!sqlQuery.trim());

  // Check if current config differs from saved
  const isDirty = (() => {
    if (mode === 'manual') return false; // manual applies immediately
    if (mode === 'question') {
      if (parameter.source?.type !== 'question') return !!draftQuestionId && !!draftColumn;
      return draftQuestionId !== parameter.source.id || draftColumn !== parameter.source.column;
    }
    if (mode === 'sql') {
      if (parameter.source?.type !== 'sql') return !!sqlQuery.trim();
      return sqlQuery.trim() !== parameter.source.query;
    }
    return false;
  })();

  const handleApply = () => {
    if (mode === 'question' && draftQuestionId && draftColumn) {
      onParameterChange({ ...parameter, source: { type: 'question', id: draftQuestionId, column: draftColumn } });
    } else if (mode === 'sql' && sqlQuery.trim()) {
      onParameterChange({ ...parameter, source: { type: 'sql', query: sqlQuery.trim() } });
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Configure source"
        title="Configure parameter source"
        className={`inline-flex shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent hover:text-[#16a085] ${
          isFromQuestion || isFromSql ? 'text-[#16a085]' : 'text-muted-foreground'
        }`}
        style={{ height: ROW_H, width: ROW_H, minWidth: ROW_H }}
      >
        <LuSettings2 style={{ width: 13, height: 13 }} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[280px] overflow-visible p-3"
        // Don't yank focus into the panel on open — the Display-name input lifts state
        // to the parent on every keystroke, and a re-run of initial focus mid-type was
        // the historic lose-every-character bug this popover carries a scar from.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-stretch gap-3">
          {/* Display name */}
          <div>
            <p className={SECTION_TITLE}>
              Display name
            </p>
            <Input
              aria-label={`Display name for ${parameter.name}`}
              className="bg-muted border-border px-2 text-xs md:text-xs focus-visible:border-[#16a085] focus-visible:ring-[#16a085]/40"
              style={{ height: ROW_H }}
              placeholder={generateLabel(parameter.name)}
              value={parameter.label ?? ''}
              onChange={(e) => onParameterChange({ ...parameter, label: e.target.value || null })}
            />
          </div>

          {/* Type selector */}
          {onTypeChange && !disableTypeChange && (
            <div>
              <p className={SECTION_TITLE}>
                Type
              </p>
              <div className="flex items-center gap-1">
                {([
                  { value: 'text', label: 'Text' },
                  { value: 'number', label: 'Number' },
                  { value: 'date', label: 'Date' },
                ] as const).map((opt) => {
                  const hex = typeHex(opt.value);
                  const active = parameter.type === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${PILL_BASE} gap-1 ${active ? '' : 'border-border bg-muted text-foreground hover:border-[var(--pt)] hover:text-[var(--pt)]'}`}
                      style={{
                        ['--pt' as never]: hex,
                        ...(active ? { borderColor: hex, background: mix(hex, 10), color: hex } : {}),
                      }}
                      onClick={() => onTypeChange(opt.value)}
                    >
                      {React.createElement(getTypeIcon(opt.value), { size: 14 })}
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p className={SECTION_TITLE}>
              Source
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {([
                { value: 'manual', label: 'Free input' },
                { value: 'question', label: 'Saved question' },
                { value: 'sql', label: 'Inline SQL' },
              ] as const).map((opt) => {
                const active = mode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${PILL_BASE} ${active ? '' : 'border-border bg-muted text-foreground hover:border-[#16a085] hover:text-[#16a085]'}`}
                    style={active ? { borderColor: TEAL, background: mix(TEAL, 10), color: TEAL } : undefined}
                    onClick={() => handleModeChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {mode === 'sql' && (
            <div>
              <p className={SECTION_TITLE}>
                Query
              </p>
              <textarea
                className="min-h-[60px] w-full resize-y rounded border border-border bg-muted px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-[#16a085]"
                placeholder="SELECT DISTINCT year FROM sales"
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
              />
            </div>
          )}

          {mode === 'question' && (
            <>
              <div>
                <p className={SECTION_TITLE}>
                  Question
                </p>
                <FileSearchSelect
                  files={questionList}
                  selectedId={draftQuestionId}
                  onSelect={handleQuestionSelect}
                  placeholder="Search questions…"
                />
              </div>

              {draftQuestionId && (
                <div>
                  <p className={SECTION_TITLE}>
                    Column
                    {parameter.type === 'number' && (
                      <span className="ml-1">(numeric only)</span>
                    )}
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm border border-border bg-muted px-2.5 py-1.5 font-mono text-xs outline-none hover:border-[#16a085]"
                    >
                      <span className={`line-clamp-1 text-left ${draftColumn ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {loadingCols ? 'Loading…' : draftColumn || '— select column —'}
                      </span>
                      <LuChevronDown size={12} className="shrink-0" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-[200px] min-w-[200px] overflow-y-auto">
                      {filteredColumns.length === 0 ? (
                        <div className="px-3 py-2">
                          <p className="text-xs text-muted-foreground">{loadingCols ? 'Loading…' : 'No columns found'}</p>
                        </div>
                      ) : filteredColumns.map(c => (
                        <DropdownMenuItem
                          key={c.name}
                          className="cursor-pointer px-3 py-1.5"
                          onClick={() => handleColumnSelect(c.name)}
                        >
                          <span className="font-mono text-xs">{c.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </>
          )}
          {/* Apply button */}
          {(mode === 'question' || mode === 'sql') && (
            <Button
              size="xs"
              className="w-full bg-[#16a085] font-mono text-xs font-semibold text-white hover:bg-[#16a085]/90"
              disabled={!canApply || !isDirty}
              onClick={handleApply}
            >
              Apply
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
