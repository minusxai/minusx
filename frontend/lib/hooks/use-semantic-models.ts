'use client';

/**
 * Authored semantic models for a path + connection. Thin React wrapper over
 * `fetchScopedModels` (cached per path/connection/tables).
 *
 * `tables` is OPTIONAL scoping: pass the primaries in play to narrow, or omit
 * it (the explorer's case) to get EVERY authored model on the connection —
 * the picker can't offer models it was never sent, and authored models are a
 * human-sized set (unlike the derived vocabulary this replaced).
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchScopedModels } from '@/lib/semantic/models-client';
import type { SemanticModelV2 } from '@/lib/types';

export function useSemanticModels(
  path: string | undefined,
  connection: string | undefined,
  tables: string[] = [],
): { models: SemanticModelV2[]; loading: boolean } {
  const [state, setState] = useState<{ models: SemanticModelV2[]; loading: boolean }>({ models: [], loading: false });
  const key = useMemo(() => `${path ?? ''}|${connection ?? ''}|${[...new Set(tables)].sort().join(',')}`, [path, connection, tables]);

  useEffect(() => {
    let cancelled = false;
    const [p, c, t] = [key.split('|')[0], key.split('|')[1], key.split('|')[2]];
    const wanted = t ? t.split(',') : [];
    if (!p || !c) {
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
