'use client';

/**
 * On-demand semantic models for a set of base tables. Thin React wrapper over
 * `fetchScopedModels` (cached per path/connection/tables) — the builder asks
 * for exactly the tables in play instead of receiving every derived model.
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchScopedModels } from '@/lib/semantic/models-client';
import type { SemanticModelV2 } from '@/lib/types';

export function useSemanticModels(
  path: string | undefined,
  connection: string | undefined,
  tables: string[],
): { models: SemanticModelV2[]; loading: boolean } {
  const [state, setState] = useState<{ models: SemanticModelV2[]; loading: boolean }>({ models: [], loading: false });
  const key = useMemo(() => `${path ?? ''}|${connection ?? ''}|${[...new Set(tables)].sort().join(',')}`, [path, connection, tables]);

  useEffect(() => {
    let cancelled = false;
    const [p, c, t] = [key.split('|')[0], key.split('|')[1], key.split('|')[2]];
    const wanted = t ? t.split(',') : [];
    if (!p || !c || wanted.length === 0) {
      Promise.resolve().then(() => { if (!cancelled) setState({ models: [], loading: false }); });
      return () => { cancelled = true; };
    }
    Promise.resolve().then(() => { if (!cancelled) setState((prev) => ({ ...prev, loading: true })); });
    fetchScopedModels(p, c, wanted).then((models) => {
      if (!cancelled) setState({ models, loading: false });
    });
    return () => { cancelled = true; };
  }, [key]);

  return state;
}
