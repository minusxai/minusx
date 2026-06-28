'use client';

import { useEffect, useState } from 'react';
import { CompletionsAPI } from '@/lib/data/completions/completions';

export interface GuiCompat {
  /** Whether the SQL can be opened in the visual query builder. */
  canUseGUI: boolean;
  /** Reason the SQL can't be opened in GUI mode (tooltip), or null when it can. */
  guiError: string | null;
}

/**
 * Proactively checks whether a SQL string parses into the query-builder IR, so
 * callers can dim/disable the GUI tab when it can't (rather than letting the
 * user enter and hit a "cannot be edited in GUI mode" fallback).
 *
 * Re-runs whenever the SQL or dialect changes — a superset of "on run", since
 * GUI-ability depends only on the query text, not on execution. Empty SQL is
 * treated as GUI-able (nothing to fail on).
 */
export function useGuiCompat(sql: string | undefined, dialect: string): GuiCompat {
  const [canUseGUI, setCanUseGUI] = useState(true);
  const [guiError, setGuiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Resolve to a GuiCompat off the effect body so all setState happens in the
    // async callback (avoids cascading-render lint + synchronous effect updates).
    // sqlToIR resolves (never rejects) on a parse failure, signalling it via
    // `success: false` — so inspect the result rather than relying on `.catch`.
    const compat: Promise<GuiCompat> = !sql?.trim()
      ? Promise.resolve({ canUseGUI: true, guiError: null })
      : CompletionsAPI.sqlToIR({ sql, dialect }).then(
          (result) =>
            result.success && result.ir
              ? { canUseGUI: true, guiError: null }
              : { canUseGUI: false, guiError: result.error || 'This query cannot be edited in GUI mode' },
          // Unexpected transport error — treat as not GUI-able rather than throwing.
          (err: unknown) => ({
            canUseGUI: false,
            guiError: err instanceof Error ? err.message : 'This query cannot be edited in GUI mode',
          }),
        );

    compat.then((next) => {
      if (cancelled) return;
      setCanUseGUI(next.canUseGUI);
      setGuiError(next.guiError);
    });

    return () => { cancelled = true; };
  }, [sql, dialect]);

  return { canUseGUI, guiError };
}
