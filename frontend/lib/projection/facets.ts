/**
 * Facet diffing — the reusable core of the append-only-log → LLM-message projection.
 *
 * The conversation log is append-only and full-fidelity: every turn stores the COMPLETE
 * app state / tool output (file metadata, markup, images, query results). That log gets
 * large, which is fine — it is never sent verbatim. At the single LLM boundary we PROJECT
 * the log to messages, and along the way we DIFF each piece of state against its most
 * recent occurrence *within the window we are emitting*. Unchanged pieces collapse to a
 * tiny `{ unchanged: true }` marker; only what actually changed is re-sent in full.
 *
 * A "facet" is one independently-diffable piece of a file: its metadata (`data`), its JSX
 * `markup`, its `image`, or a query result's `summary` / `data` / `image`. Diffing happens
 * per-facet (not per-file) so that, e.g., a file whose chart re-rendered re-sends only the
 * image while its unchanged markup stays a marker.
 *
 * Design invariants (see also the Phase C projector):
 * - **Forward-only.** A turn may be slimmed relative to EARLIER turns, never the reverse.
 *   Earlier emitted messages stay byte-identical across re-projections, so the provider
 *   prompt cache prefix holds.
 * - **Baseline = the emitted window.** {@link FacetMemo} is seeded by walking exactly the
 *   turns being emitted. When history is summarized up to message N, the projector resets
 *   the memo at N and recomputes forward, so an `unchanged` marker can never point at a
 *   value the model can no longer see.
 *
 * Pure + dependency-light (only canonical-JSON for stable hashing) so it can be unit-tested
 * in isolation and reused by both the client and headless/server projection paths.
 */
import { sortObjectKeysDeep } from '@/lib/chat/file-encoding';

/** Replaces a facet whose value is identical to its previous in-window occurrence. */
export interface Unchanged {
  unchanged: true;
}

/** A facet value as projected: either the full value (new/changed) or an {@link Unchanged} marker. */
export type Diffed<T> = T | Unchanged;

export function isUnchanged(v: unknown): v is Unchanged {
  return typeof v === 'object' && v !== null && (v as { unchanged?: unknown }).unchanged === true;
}

/**
 * Stable content hash of any JSON-serializable value. Object keys are canonicalized first
 * so that `{a,b}` and `{b,a}` hash equal — diffing must key on content, not serialization
 * order. djb2 over the canonical JSON string; returned as an unsigned hex string.
 */
export function facetHash(value: unknown): string {
  const json = JSON.stringify(sortObjectKeysDeep(value));
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/**
 * Forward memo of the last-seen hash per facet key. Drive it by walking the turns to be
 * emitted in order, calling {@link diff} for each facet; identical repeats collapse to
 * {@link Unchanged}. Call {@link reset} at a summarization boundary to rebase.
 */
export class FacetMemo {
  private readonly last = new Map<string, string>();

  /**
   * Diff one facet by its stable key.
   * - `undefined` value → passes through as `undefined` (facet absent this turn); the
   *   baseline is left untouched so a later reappearance is judged against the last value
   *   actually emitted.
   * - first occurrence / changed value → returns the full value and records its hash.
   * - identical to the recorded hash → returns `{ unchanged: true }`.
   */
  diff<T>(key: string, value: T | undefined): Diffed<T> | undefined {
    if (value === undefined) return undefined;
    const hash = facetHash(value);
    if (this.last.get(key) === hash) return { unchanged: true };
    this.last.set(key, hash);
    return value;
  }

  /** Whether this facet key currently has a recorded baseline. */
  has(key: string): boolean {
    return this.last.has(key);
  }

  /** Drop all baselines (e.g. at a summarization boundary) so the next pass re-emits in full. */
  reset(): void {
    this.last.clear();
  }
}
