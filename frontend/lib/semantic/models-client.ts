'use client';

/**
 * Client access to AUTHORED semantic models (POST /api/semantic-models).
 * Optionally scoped to the primaries in play (detection asks for exactly the
 * tables the SQL touches); an EMPTY table list means UNSCOPED — every authored
 * model on the connection, which is what the explorer's model picker lists
 * before anything is picked. Responses are cached per (path, connection,
 * tables) for the session; the vocabulary only changes when a model is
 * re-authored, and a page reload is acceptable staleness for that.
 */

import type { SemanticModelV2 } from '@/lib/types';
import type { SemanticFieldHit } from '@/lib/semantic/models.server';

export type { SemanticFieldHit };

// eslint-disable-next-line no-restricted-syntax -- module-level session cache; vocabulary is stable per page load
const cache = new Map<string, Promise<SemanticModelV2[]>>();

export async function fetchScopedModels(
  path: string,
  connection: string,
  tables: string[] = [],
): Promise<SemanticModelV2[]> {
  const wanted = [...new Set(tables)].sort();
  if (!path || !connection) return [];
  const key = `${path}|${connection}|${wanted.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const load = fetch('/api/semantic-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, connection, tables: wanted }),
  })
    .then((r) => (r.ok ? r.json() : { data: { models: [] } }))
    .then((body) => (body?.data?.models ?? []) as SemanticModelV2[])
    .catch(() => {
      cache.delete(key); // don't cache transport failures
      return [] as SemanticModelV2[];
    });
  cache.set(key, load);
  return load;
}

/** Metrics-first typeahead: search measures/dimensions across the whitelist. */
export async function searchFields(
  path: string,
  connection: string,
  q: string,
): Promise<SemanticFieldHit[]> {
  if (!path || !connection) return [];
  try {
    const r = await fetch('/api/semantic-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, connection, q }),
    });
    if (!r.ok) return [];
    const body = await r.json();
    return (body?.data?.fields ?? []) as SemanticFieldHit[];
  } catch {
    return [];
  }
}
