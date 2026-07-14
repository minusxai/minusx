'use client';

/**
 * Client access to on-demand semantic models (POST /api/semantic-models).
 * Models are derived per request, scoped to the tables in play — never stored
 * on the context content (multi-MB on large workspaces; see derive.ts).
 * Responses are cached per (path, connection, tables) for the session; the
 * vocabulary only changes when the schema or relationships change, and a
 * page reload is acceptable staleness for that.
 */

import type { SemanticModel } from '@/lib/types';

// eslint-disable-next-line no-restricted-syntax -- module-level session cache; vocabulary is stable per page load
const cache = new Map<string, Promise<SemanticModel[]>>();

export async function fetchScopedModels(
  path: string,
  connection: string,
  tables: string[],
): Promise<SemanticModel[]> {
  const wanted = [...new Set(tables)].sort();
  if (!path || !connection || wanted.length === 0) return [];
  const key = `${path}|${connection}|${wanted.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const load = fetch('/api/semantic-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, connection, tables: wanted }),
  })
    .then((r) => (r.ok ? r.json() : { data: { models: [] } }))
    .then((body) => (body?.data?.models ?? []) as SemanticModel[])
    .catch(() => {
      cache.delete(key); // don't cache transport failures
      return [] as SemanticModel[];
    });
  cache.set(key, load);
  return load;
}
