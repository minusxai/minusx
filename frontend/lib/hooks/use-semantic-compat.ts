'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { semanticSpecFromIr } from '@/lib/semantic/detect';
import { fetchScopedModels } from '@/lib/semantic/models-client';
import type { AnyQueryIR, QueryIR } from '@/lib/sql/ir-types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

export interface SemanticCompat {
  /** The spec this SQL corresponds to, when it reliably detects. */
  detected: SemanticQuerySpec | null;
  /** Whether the Semantic tab should be usable: detected, or nothing to clobber. */
  canUseSemantic: boolean;
  /** True while the detection round-trip is in flight. */
  loading: boolean;
}

export interface SemanticCompatSource {
  /** Anchor for context resolution (the file's path/folder). */
  path: string | undefined;
  connectionName: string | undefined;
  /** Whether any semantic vocabulary exists at all (whitelisted tables). */
  hasTables: boolean;
}

/**
 * Detects whether the current SQL is expressible as a semantic query. Parsing
 * happens server-side (CompletionsAPI.sqlToIR — the same dialect-aware parser
 * everything else uses); authored models are fetched SCOPED to the primaries
 * the SQL actually touches (fetchScopedModels — detection only ever needs
 * those); the vocabulary mapping and recompile-verification run locally (pure,
 * lib/semantic/detect).
 *
 * Empty SQL counts as semantic-capable (a fresh question can start semantic);
 * SQL that doesn't detect leaves the Semantic tab disabled so it can never
 * silently overwrite a hand-written query.
 */
export function useSemanticCompat(
  sql: string | undefined,
  dialect: string,
  { path, connectionName, hasTables }: SemanticCompatSource,
): SemanticCompat {
  const [state, setState] = useState<SemanticCompat>({ detected: null, canUseSemantic: false, loading: false });
  const stateRef = useRef(state);

  const sourceKey = useMemo(() => `${path ?? ''}|${connectionName ?? ''}|${hasTables}`, [path, connectionName, hasTables]);

  useEffect(() => {
    let cancelled = false;
    const [anchor, connection] = sourceKey.split('|');

    const next: Promise<SemanticCompat> =
      !hasTables || !connection
        ? Promise.resolve({ detected: null, canUseSemantic: false, loading: false })
        : !sql?.trim()
          ? Promise.resolve({ detected: null, canUseSemantic: true, loading: false })
          : CompletionsAPI.sqlToIR({ sql, dialect }).then(
              async (result) => {
                if (!result.success || !result.ir) return { detected: null, canUseSemantic: false, loading: false };
                const ir = result.ir as QueryIR;
                const tables = [ir.from?.table, ...(ir.joins ?? []).map((j) => j.table?.table)]
                  .filter((t): t is string => !!t);
                if (tables.length === 0) return { detected: null, canUseSemantic: false, loading: false };
                const models = await fetchScopedModels(anchor, connection, tables);
                const detected = semanticSpecFromIr(result.ir as AnyQueryIR, models);
                return { detected, canUseSemantic: !!detected, loading: false };
              },
              () => ({ detected: null, canUseSemantic: false, loading: false }),
            );

    next.then((value) => {
      if (cancelled) return;
      // Value-equal updates must not re-render (guards against loops even if a
      // caller passes unstable inputs).
      const prev = stateRef.current;
      if (
        prev.loading === value.loading &&
        prev.canUseSemantic === value.canUseSemantic &&
        JSON.stringify(prev.detected) === JSON.stringify(value.detected)
      ) return;
      stateRef.current = value;
      setState(value);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, dialect, sourceKey]);

  return state;
}
