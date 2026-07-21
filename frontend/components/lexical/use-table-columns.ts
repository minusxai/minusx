'use client';

/**
 * Columns for the table highlighted in the @ mention dropdown.
 *
 * The whitelisted schemas shipped to the client are memory-bounded
 * (`lib/context/schema-bounding.ts` strips columns once a schema exceeds its
 * char budget), so the local lookup is only a fast path. When it comes back
 * empty, the columns are fetched on demand from the connection's full schema
 * via `/api/column-suggestions` (one table at a time, cached per table for the
 * session) — keeping the drill-down working at any schema size without
 * re-inflating the bounded payloads.
 */

import { useEffect, useState } from 'react';
import type { DatabaseWithSchema } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { getTableColumns, type ColumnInfo } from './mentions-plugin-utils';

/** The subset of a table mention needed to resolve its columns. */
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
  whitelistedSchemas: DatabaseWithSchema[] | undefined,
  databaseName?: string,
): ColumnInfo[] {
  const local = table ? getTableColumns(whitelistedSchemas, table.schema, table.name) : [];
  const key = table ? cacheKey(table, databaseName) : '';
  const needsFetch = !!table && local.length === 0 && !fetchedColumns.has(key);
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
        // Leave uncached so a later highlight retries.
      }
    })();
    return () => { cancelled = true; };
  }, [key, needsFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!table) return [];
  if (local.length > 0) return local;
  return fetchedColumns.get(key) ?? [];
}

/** Test-only: reset the session cache of fetched columns. */
export function clearTableColumnsCache(): void {
  fetchedColumns.clear();
}
