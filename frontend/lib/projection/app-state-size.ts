/**
 * How big is this app state *as the model will actually see it*?
 *
 * The chat client injects the `large_file` system skill when the page context is huge. The naive
 * measure — `JSON.stringify(appState).length` — is wrong by an order of magnitude: the projection
 * pass ({@link renderAppState}) strips query-result ROW data from app state (`stripQueryData`,
 * summary only) and never emits REFERENCE markup (`includeMarkup: false` in `projectFiles`), yet
 * both dominate the raw Redux object. Measuring the raw object trips the skill on files whose real
 * prompt footprint is small.
 *
 * So we measure by rendering: a first-turn projection through a FRESH {@link FacetMemo} (a shared
 * memo would collapse repeats to `{unchanged:true}` and report ~0 on the second call), summing the
 * text blocks. Image blocks count 0 — they are screenshots, orthogonal to the "large file" concern,
 * which is about markup/schema TEXT the model must read and rewrite.
 */
import type { AppState } from '@/lib/appState';
import { FacetMemo } from './facets';
import { renderAppState } from './messages';

/**
 * Characters of projected app-state text above which the `large_file` skill is injected.
 *
 * Calibrated against real authored files, not guessed. The old 200_000 was chosen for the RAW
 * JSON measure (rows + reference content inflate it ~1.3–40x depending on file type); carried over
 * to projected text it would be effectively dead — across 21 real stories in local workspaces the
 * markup distribution is median 248, p95 15.6k, max 103k chars, and NOTHING reaches 200k.
 *
 * 60_000 chars ≈ 15k tokens of markup for ONE file: ~4x above the p95 real story, so ordinary work
 * never trips it, while a document whose full rewrite would alone cost ~15k output tokens — the
 * regime where targeted edits actually matter — always does. Dashboards/questions/notebooks project
 * to a few KB (references are metadata-only, rows are stripped) and are correctly never flagged.
 */
export const LARGE_APP_STATE_THRESHOLD = 60_000;

/** Characters of text the projection pass would render for `appState` on a first turn. */
export function projectedAppStateChars(appState: AppState | null | undefined): number {
  if (appState == null) return 0;
  const blocks = renderAppState(new FacetMemo(), appState);
  return blocks.reduce((n, b) => (b.type === 'text' ? n + b.text.length : n), 0);
}

/** Whether this page context is large enough to warrant the `large_file` handling skill. */
export function shouldInjectLargeFileSkill(appState: AppState | null | undefined): boolean {
  return projectedAppStateChars(appState) > LARGE_APP_STATE_THRESHOLD;
}
