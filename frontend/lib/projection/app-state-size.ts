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
 * Projected app-state size above which the `large_file` skill is injected, expressed in TOKENS
 * (the unit that actually matters for context budgeting) and converted to the characters that
 * {@link projectedAppStateChars} measures.
 *
 * Set to 100k tokens by product decision: the skill is reserved for page contexts big enough to
 * threaten the context window itself — roughly half a modern window — not merely "a long story".
 * For scale: across 21 real stories in local workspaces the projected markup tops out at ~103k
 * chars (≈26k tokens), so today's authored content never trips this; only genuinely enormous
 * contexts do. Dashboards/questions/notebooks project to a few KB (references are metadata-only,
 * query rows are stripped) and are never flagged.
 */
export const LARGE_APP_STATE_TOKENS = 100_000;
/** Rough prose/markup conversion used only for this threshold. */
const CHARS_PER_TOKEN = 4;
export const LARGE_APP_STATE_THRESHOLD = LARGE_APP_STATE_TOKENS * CHARS_PER_TOKEN;

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
