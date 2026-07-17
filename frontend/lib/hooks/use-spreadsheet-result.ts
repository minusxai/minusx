'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type { QueryResult, SpreadsheetSource } from '@/lib/types';
import { cacheSpreadsheetSource } from '@/lib/spreadsheet/result-cache';
import { runSpreadsheetSource, type CellValidationError } from '@/lib/spreadsheet/materialize';

export interface SpreadsheetResultState {
  data: QueryResult | null;
  loading: false;
  error: string | null;
  errors: CellValidationError[];
  isStale: false;
  refetch: () => void;
}

function errorText(errors: CellValidationError[]): string {
  if (errors.length === 0) return '';
  if (errors.length === 1) return errors[0].message;
  return `${errors[0].message} (${errors.length} validation errors)`;
}

/** Client bridge from a persisted spreadsheet snapshot to the shared query-result cache. */
export function useSpreadsheetResult(
  source: SpreadsheetSource | null | undefined,
  options: { skip?: boolean } = {},
): SpreadsheetResultState {
  const skip = options.skip ?? false;
  const result = useMemo(
    () => (!source || skip ? null : runSpreadsheetSource(source)),
    [source, skip],
  );

  useEffect(() => {
    if (source && !skip && result?.ok) cacheSpreadsheetSource(source);
  }, [source, skip, result]);

  const refetch = useCallback(() => {
    if (source && !skip) cacheSpreadsheetSource(source);
  }, [source, skip]);

  const errors = result && !result.ok ? result.errors : [];
  return {
    data: result?.ok ? result.data : null,
    loading: false,
    error: errors.length ? errorText(errors) : null,
    errors,
    isStale: false,
    refetch,
  };
}
