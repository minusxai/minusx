'use client';

import { useEffect, useState } from 'react';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { simpleSpecFromIr } from '@/lib/sql/simple-query';
import type { AnyQueryIR } from '@/lib/sql/ir-types';

export interface GuiCompat {
  /** Whether the SQL can be opened in the visual query builder. */
  canUseGUI: boolean;
  /** Reason the SQL can't be opened in GUI mode (tooltip), or null when it can. */
  guiError: string | null;
  /** Whether the SQL additionally fits the Simple tier (Scuba-style builder). */
  canUseSimple: boolean;
  /** Reason the SQL can't be opened in Simple mode (tooltip), or null when it can. */
  simpleError: string | null;
}

const GUI_OK: GuiCompat = { canUseGUI: true, guiError: null, canUseSimple: true, simpleError: null };

const notGuiAble = (error: string | null): GuiCompat => ({
  canUseGUI: false,
  guiError: error || 'This query cannot be edited in GUI mode',
  // Simple is a strict subset of GUI: not GUI-able ⇒ not Simple-able.
  canUseSimple: false,
  simpleError: error || 'This query cannot be edited in Simple mode',
});

const fromIr = (ir: AnyQueryIR): GuiCompat => {
  const fit = simpleSpecFromIr(ir);
  return fit.fits
    ? GUI_OK
    : { canUseGUI: true, guiError: null, canUseSimple: false, simpleError: `Not available in Simple mode: ${fit.reasons.join(', ')}` };
};

/**
 * Proactively checks whether a SQL string parses into the query-builder IR, so
 * callers can dim/disable the GUI tab when it can't (rather than letting the
 * user enter and hit a "cannot be edited in GUI mode" fallback). The same
 * single sqlToIR round-trip also grades the Simple tier: `canUseSimple` is true
 * only when the parsed IR fits the Scuba-style subset (`simpleSpecFromIr`).
 *
 * Re-runs whenever the SQL or dialect changes — a superset of "on run", since
 * GUI-ability depends only on the query text, not on execution. Empty SQL is
 * treated as GUI-able and Simple-able (nothing to fail on).
 */
export function useGuiCompat(sql: string | undefined, dialect: string): GuiCompat {
  const [compat, setCompat] = useState<GuiCompat>(GUI_OK);

  useEffect(() => {
    let cancelled = false;

    // Resolve to a GuiCompat off the effect body so all setState happens in the
    // async callback (avoids cascading-render lint + synchronous effect updates).
    // sqlToIR resolves (never rejects) on a parse failure, signalling it via
    // `success: false` — so inspect the result rather than relying on `.catch`.
    const next: Promise<GuiCompat> = !sql?.trim()
      ? Promise.resolve(GUI_OK)
      : CompletionsAPI.sqlToIR({ sql, dialect }).then(
          (result) =>
            result.success && result.ir
              ? fromIr(result.ir as AnyQueryIR)
              : notGuiAble(result.error || null),
          // Unexpected transport error — treat as not GUI-able rather than throwing.
          (err: unknown) => notGuiAble(err instanceof Error ? err.message : null),
        );

    next.then((value) => {
      if (!cancelled) setCompat(value);
    });

    return () => { cancelled = true; };
  }, [sql, dialect]);

  return compat;
}
