'use client';

import { useEffect, useState } from 'react';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { semanticSpecFromIr } from '@/lib/semantic/detect';
import type { AnyQueryIR } from '@/lib/sql/ir-types';
import type { SemanticModel } from '@/lib/types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

export interface SemanticCompat {
  /** The spec this SQL corresponds to, when it reliably detects. */
  detected: SemanticQuerySpec | null;
  /** Whether the Semantic tab should be usable: detected, or nothing to clobber. */
  canUseSemantic: boolean;
  /** True while the detection round-trip is in flight. */
  loading: boolean;
}

/**
 * Detects whether the current SQL is expressible as a semantic query against
 * the given models. Parsing happens server-side (CompletionsAPI.sqlToIR — the
 * same dialect-aware parser everything else uses); the vocabulary mapping and
 * recompile-verification run locally (pure, lib/semantic/detect).
 *
 * Empty SQL counts as semantic-capable (a fresh question can start semantic);
 * SQL that doesn't detect leaves the Semantic tab disabled so it can never
 * silently overwrite a hand-written query.
 */
export function useSemanticCompat(
  sql: string | undefined,
  dialect: string,
  models: SemanticModel[],
): SemanticCompat {
  const [state, setState] = useState<SemanticCompat>({ detected: null, canUseSemantic: false, loading: false });

  useEffect(() => {
    let cancelled = false;

    // Resolve off the effect body so all setState happens in async callbacks
    // (avoids the cascading-render lint; same pattern the other compat hooks use).
    const next: Promise<SemanticCompat> =
      models.length === 0
        ? Promise.resolve({ detected: null, canUseSemantic: false, loading: false })
        : !sql?.trim()
          ? Promise.resolve({ detected: null, canUseSemantic: true, loading: false })
          : CompletionsAPI.sqlToIR({ sql, dialect }).then(
              (result) => {
                const detected = result.success && result.ir
                  ? semanticSpecFromIr(result.ir as AnyQueryIR, models)
                  : null;
                return { detected, canUseSemantic: !!detected, loading: false };
              },
              () => ({ detected: null, canUseSemantic: false, loading: false }),
            );

    next.then((value) => {
      if (!cancelled) setState(value);
    });

    return () => { cancelled = true; };
  }, [sql, dialect, models]);

  return state;
}
