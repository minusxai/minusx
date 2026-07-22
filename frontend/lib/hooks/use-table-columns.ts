'use client';

/**
 * Columns for one table, resolved lazily.
 *
 * The schemas shipped to the client are memory-bounded
 * (`lib/context/schema-bounding.ts` strips columns once a schema exceeds its
 * char budget), so the caller's local columns are only a fast path. When they
 * are empty, the columns are fetched on demand from the connection's full
 * schema via `/api/column-suggestions` (one table at a time, cached per table
 * for the session) — keeping column UIs (mention drill-down, whitelist tree)
 * working at any schema size without re-inflating the bounded payloads.
 */

import { useEffect, useState } from 'react';
import { CompletionsAPI } from '@/lib/data/completions/completions';

export interface ColumnInfo {
  name: string;
  type: string;
}

/** The subset of a table reference needed to resolve its columns. */
export interface TableRef {
  name: string;
  schema?: string;
  connection?: string;
}

/** Session cache of fetched columns, keyed by connection|schema|table. Only
 * successful responses are cached, so transient failures retry later. */
// eslint-disable-next-line no-restricted-syntax -- client-only ('use client') browser-session cache; never runs server-side, so no cross-request sharing
const fetchedColumns = new Map<string, ColumnInfo[]>();

const cacheKey = (table: TableRef, databaseName?: string): string =>
  `${table.connection || databaseName || ''}|${table.schema || ''}|${table.name}`;

export function useTableColumns(
  table: TableRef | null,
  localColumns: ColumnInfo[],
  databaseName?: string,
): ColumnInfo[] {
  const key = table ? cacheKey(table, databaseName) : '';
  const needsFetch = !!table && localColumns.length === 0 && !fetchedColumns.has(key);
  // Bumped when a fetch lands, so the render below re-reads the cache.
  const [, setFetchCount] = useState(0);

  useEffect(() => {
    if (!needsFetch || !table) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await CompletionsAPI.getColumnSuggestions({
          databaseName: table.connection || databaseName || '',
          table: table.name,
          schema: table.schema,
        });
        if (result.success && result.columns) {
          fetchedColumns.set(key, result.columns.map((c) => ({ name: c.name, type: c.type || '' })));
          if (!cancelled) setFetchCount((n) => n + 1);
        }
      } catch {
        // Leave uncached so a later mount retries.
      }
    })();
    return () => { cancelled = true; };
  }, [key, needsFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!table) return [];
  if (localColumns.length > 0) return localColumns;
  return fetchedColumns.get(key) ?? [];
}

/** Test-only: reset the session cache of fetched columns. */
export function clearTableColumnsCache(): void {
  fetchedColumns.clear();
}
