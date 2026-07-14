'use client';

/**
 * QueryValueSelector — THE way to point at a value inside a query's result.
 *
 * One source of truth for "given a question or an inline SQL query, pick a
 * column (and optionally a row)". Used by alerts/evals (trigger on a value or
 * on any value in a column) and parameter dropdown sources — anything that
 * needs a cell/column out of a result, without a SQL GUI.
 *
 * - `useInferredColumns(source)` resolves the output columns of either source
 *   kind via /api/infer-columns (WASM SQL analysis server-side; no execution).
 * - `ColumnSelect` renders them as a dropdown ("first column" default), with a
 *   free-text fallback while columns are unknown.
 * - `RowSelect` encodes RowIndex semantics (0 = first, -1 = last, Nth).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, HStack, Input, Text } from '@chakra-ui/react';
import type { RowIndex } from '@/lib/types';

// ---------------------------------------------------------------------------
// Source + column inference
// ---------------------------------------------------------------------------

export type ValueSource =
  | { kind: 'question'; questionId: number }
  | { kind: 'inline'; sql: string; connectionName: string };

export interface InferredColumn { name: string; type: string }

const selectStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--font-jetbrains-mono), monospace',
  padding: '0 6px',
  border: '1px solid var(--chakra-colors-border-muted)',
  borderRadius: '6px',
  background: 'var(--chakra-colors-bg-canvas)',
  color: 'var(--chakra-colors-fg-default)',
  outline: 'none',
  height: '32px',
  cursor: 'pointer',
  width: '100%',
  minWidth: 0,
};

/**
 * Infer the output columns of a question or inline SQL query. Debounced for
 * inline SQL (typing); resolves [] on any failure — consumers fall back to a
 * free-text column input, never a dead end.
 */
export function useInferredColumns(source: ValueSource | null): { columns: InferredColumn[]; loading: boolean } {
  const [state, setState] = useState<{ columns: InferredColumn[]; loading: boolean }>({ columns: [], loading: false });

  const body = useMemo(() => {
    if (!source) return null;
    if (source.kind === 'question') {
      return source.questionId > 0 ? JSON.stringify({ questionId: source.questionId }) : null;
    }
    return source.sql.trim() && source.connectionName
      ? JSON.stringify({ sql: source.sql, connectionName: source.connectionName })
      : null;
  }, [source]);
  const debounceMs = source?.kind === 'inline' ? 500 : 0;

  useEffect(() => {
    let cancelled = false;
    // All setState happens in async callbacks (cascading-render lint).
    const started = Promise.resolve();
    if (!body) {
      started.then(() => { if (!cancelled) setState({ columns: [], loading: false }); });
      return () => { cancelled = true; };
    }
    started.then(() => { if (!cancelled) setState((prev) => ({ ...prev, loading: true })); });
    const timer = setTimeout(() => {
      fetch('/api/infer-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
        .then((r) => (r.ok ? r.json() : { columns: [] }))
        .then((data) => {
          if (!cancelled) {
            setState({
              columns: (data?.columns ?? []).map((c: { name: string; type?: string }) => ({ name: c.name, type: c.type ?? '' })),
              loading: false,
            });
          }
        })
        .catch(() => { if (!cancelled) setState({ columns: [], loading: false }); });
    }, debounceMs);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [body, debounceMs]);

  return state;
}

// ---------------------------------------------------------------------------
// Column selection
// ---------------------------------------------------------------------------

interface ColumnSelectProps {
  columns: InferredColumn[];
  /** undefined = "first column" (the default in every consumer). */
  value: string | undefined;
  onChange: (column: string | undefined) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export function ColumnSelect({ columns, value, onChange, disabled, 'aria-label': ariaLabel = 'Column' }: ColumnSelectProps) {
  // Columns unknown (inference failed / still loading): free-text fallback so
  // the user is never blocked.
  if (columns.length === 0) {
    return (
      <Input
        aria-label={ariaLabel}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder="(first column)"
        size="sm"
        bg="bg.surface"
        fontSize="xs"
        fontFamily="mono"
        disabled={disabled}
      />
    );
  }
  return (
    <select
      aria-label={ariaLabel}
      style={selectStyle}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">(first column)</option>
      {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      {/* Preserve a saved column that inference no longer reports. */}
      {value && !columns.some((c) => c.name === value) && <option value={value}>{value}</option>}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Row selection (RowIndex: 0 = first, -1 = last, n = nth / from-end)
// ---------------------------------------------------------------------------

interface RowSelectProps {
  /** undefined defaults to 0 (first row) — same convention as RowIndex. */
  value: RowIndex | undefined;
  onChange: (row: RowIndex | undefined) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export function RowSelect({ value, onChange, disabled, 'aria-label': ariaLabel = 'Row' }: RowSelectProps) {
  const mode = value === undefined || value === 0 ? 'first' : value === -1 ? 'last' : 'nth';
  return (
    <HStack gap={1.5}>
      <select
        aria-label={ariaLabel}
        style={{ ...selectStyle, width: mode === 'nth' ? '110px' : '100%' }}
        value={mode}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next === 'first' ? undefined : next === 'last' ? -1 : 1);
        }}
      >
        <option value="first">first row</option>
        <option value="last">last row</option>
        <option value="nth">row #…</option>
      </select>
      {mode === 'nth' && (
        <Input
          aria-label={`${ariaLabel} index`}
          type="number"
          value={value ?? 0}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            onChange(isNaN(v) ? undefined : v);
          }}
          size="sm"
          bg="bg.surface"
          fontSize="xs"
          w="80px"
          disabled={disabled}
          title="0 = first, -1 = last, -2 = second from last"
        />
      )}
    </HStack>
  );
}

// ---------------------------------------------------------------------------
// Combined selector
// ---------------------------------------------------------------------------

interface QueryValueSelectorProps {
  source: ValueSource | null;
  column: string | undefined;
  onColumnChange: (column: string | undefined) => void;
  /** Omit to hide row selection (column-only consumers, e.g. param sources). */
  row?: RowIndex | undefined;
  onRowChange?: (row: RowIndex | undefined) => void;
  disabled?: boolean;
}

export function QueryValueSelector({ source, column, onColumnChange, row, onRowChange, disabled }: QueryValueSelectorProps) {
  const { columns } = useInferredColumns(source);
  return (
    <HStack gap={2} align="end">
      <Box flex={1}>
        <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Column</Text>
        <ColumnSelect columns={columns} value={column} onChange={onColumnChange} disabled={disabled} />
      </Box>
      {onRowChange && (
        <Box w="180px">
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Row</Text>
          <RowSelect value={row} onChange={onRowChange} disabled={disabled} />
        </Box>
      )}
    </HStack>
  );
}
