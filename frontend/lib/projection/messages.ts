/**
 * The single projection pass — `projectMessages(messages)` walks an assembled `Message[]` in order
 * through ONE {@link FacetMemo} and rewrites every message that carries rich file state into its
 * diffed LLM content. This is where append-only fidelity becomes a lean, cross-turn-deduped prompt.
 *
 * Rich state rides on messages between assembly and this pass, never on the wire:
 * - a user message carries its page context as `_appState` (the {@link AppState} union);
 * - a tool-result message carries its file payload in `details.__augmented` (+ optional
 *   `__jsonTag`) — set by the file tool handlers.
 *
 * Messages without rich state pass through untouched, so non-file agents/tools are unaffected.
 * The memo is created fresh per pass (we re-project from the full log every call) and walks
 * oldest→newest, so slimming only ever lands on later turns — earlier turns stay byte-identical
 * across calls, keeping the provider prompt-cache prefix stable.
 */
import type { Message, TextContent, ImageContent } from '@/orchestrator/llm';
import { appStateForLlm, type AppState } from '@/lib/appState';
import { FacetMemo } from './facets';
import { compressedToAugmentedFiles } from './from-compressed';
import { projectFiles, stripEntryQueryData } from './project';
import { renderProjectedFiles } from './render';
import type { AugmentedFiles } from './types';

/** Non-wire markers a user message carries between assembly and this pass. */
export interface WithAppState {
  _appState?: AppState;
  /** The turn's wall-clock hour, frozen at creation (orchestrator.run) — rendered as <CurrentTime>
   *  after the app state. Identical when the turn is current vs prior, so the cache prefix holds. */
  _currentTime?: string;
  /** Where the user is scrolled in the file view at send time (e.g. "The user is viewing sections
   *  2–4 of 5"), rendered as <Viewport> in the tail AFTER CurrentTime. It changes on every scroll, so
   *  it sits latest in the prefix — the image + AppState + CurrentTime before it stay cached while the
   *  user scrolls. The numbers reference the position markers baked into the app-state screenshot. */
  _viewport?: string;
}

/**
 * Shape file tool handlers stash in `ToolResultMessage.details` so the pass can project it.
 * `__status` is the small non-file result (e.g. EditFile's `{success, diff, validation}`) rendered
 * as a JSON block BEFORE the projected file blocks; `__augmented` is the file payload(s).
 */
export interface AugmentedToolDetails {
  __augmented: AugmentedFiles[];
  __jsonTag?: string;
  __status?: unknown;
  /**
   * File id whose FULL-VIEW SCREENSHOT rides in this tool result's content (EditFile's post-edit
   * review). Set ONLY when a screenshot was actually captured — a deterministic-fallback review
   * leaves it unset, so nothing claims an image that never existed. The handler guarantees the
   * screenshot is the message's ONLY non-text block (its chart-image path is mutually exclusive
   * with the screenshot path), which is what lets the pass drop images wholesale below.
   */
  __screenshotOf?: number;
}

/** The stub left where a superseded screenshot was, so the model knows why the image is gone. */
export const SUPERSEDED_SCREENSHOT_STUB =
  '[screenshot omitted — superseded by a newer edit of this file; the latest screenshot is below]';

/**
 * The file id this message carries a screenshot for, or undefined. ONE predicate, used by both
 * the pre-scan and the rewrite — if they disagreed we would keep two screenshots or strip them all.
 */
function screenshotTargetOf(m: Message): number | undefined {
  if (m.role !== 'toolResult' || !hasAugmented(m.details)) return undefined;
  const id = m.details.__screenshotOf;
  if (typeof id !== 'number') return undefined;
  return (Array.isArray(m.content) ? m.content : []).some((c) => c.type !== 'text') ? id : undefined;
}

function hasAugmented(details: unknown): details is AugmentedToolDetails {
  return (
    typeof details === 'object' &&
    details !== null &&
    Array.isArray((details as { __augmented?: unknown }).__augmented)
  );
}

/**
 * Drop the query-result `data` (rows) facet from every file in app state, keeping `summary`. App
 * state ships the SHAPE (columns/types/totalRows) + a screenshot image; the agent pulls exact rows
 * on demand via ReadFiles. (Tool results — ReadFiles/EditFile — keep their `data` so the agent can
 * read the values it explicitly asked for.) Returns a shallow copy; the source is untouched.
 */
function stripQueryData(files: AugmentedFiles): AugmentedFiles {
  return { file: stripEntryQueryData(files.file), references: files.references.map(stripEntryQueryData) };
}

/** Render the app-state blocks for one user turn, advancing the memo. File pages go through the
 *  facet projector (summary only — no row data); folder/explore render their JSON inline.
 *  Exported so the size probe (`./app-state-size`) can measure the REAL prompt footprint of an app
 *  state through this exact path instead of re-deriving it. */
export function renderAppState(memo: FacetMemo, appState: AppState | undefined): (TextContent | ImageContent)[] {
  if (appState?.type === 'file' && appState.state) {
    const files: AugmentedFiles = stripQueryData(compressedToAugmentedFiles(appState.state));
    return renderProjectedFiles(projectFiles(memo, files), { jsonTag: 'AppState' });
  }
  const json = appState !== undefined ? JSON.stringify(appStateForLlm(appState)) : 'null';
  return [{ type: 'text', text: `<AppState>${json}</AppState>` }];
}

export function projectMessages(messages: Message[]): Message[] {
  const memo = new FacetMemo();
  // Pre-scan: the LAST message carrying a screenshot per file id. Every EARLIER screenshot of that
  // file is superseded by definition — the file no longer looks like that — so the rewrite below
  // drops its image and leaves the stub. This is the one place the pass rewrites an EARLIER turn
  // (the header's byte-stability note): the invalidation point is the PREVIOUS screenshot-bearing
  // edit, which in an edit loop sits near the tail, so only a short cache suffix is clipped and
  // everything before it stays byte-identical.
  const latestShotIdx = new Map<number, number>();
  messages.forEach((m, i) => {
    const fileId = screenshotTargetOf(m);
    if (fileId !== undefined) latestShotIdx.set(fileId, i);
  });
  return messages.map((m, i): Message => {
    if (m.role === 'user') {
      const wm = m as Message & WithAppState;
      if (wm._appState === undefined && wm._currentTime === undefined && wm._viewport === undefined) return m;
      const appStateBlocks = wm._appState !== undefined ? renderAppState(memo, wm._appState) : [];
      // <CurrentTime> rides right after the app state — frozen per turn, so prior turns are stable.
      const timeBlocks: TextContent[] = wm._currentTime
        ? [{ type: 'text', text: `<CurrentTime>${wm._currentTime}</CurrentTime>` }]
        : [];
      // <Viewport> is the scroll pointer — LAST in the app-context prefix (after CurrentTime) because
      // it changes on every scroll, keeping the image + AppState + time before it byte-stable/cached.
      const viewportBlocks: TextContent[] = wm._viewport
        ? [{ type: 'text', text: `<Viewport>${wm._viewport}</Viewport>` }]
        : [];
      const rest: (TextContent | ImageContent)[] =
        typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      const { _appState: _a, _currentTime: _t, _viewport: _v, ...clean } = wm;
      return { ...clean, content: [...appStateBlocks, ...timeBlocks, ...viewportBlocks, ...rest] } as Message;
    }
    if (m.role === 'toolResult' && hasAugmented(m.details)) {
      const { __augmented, __jsonTag, __status } = m.details;
      const statusBlocks: TextContent[] =
        __status !== undefined ? [{ type: 'text', text: JSON.stringify(__status) }] : [];
      const fileBlocks = __augmented.flatMap((f) =>
        renderProjectedFiles(projectFiles(memo, f), { jsonTag: __jsonTag ?? 'Files' }),
      );
      // Preserve any non-text blocks (e.g. chart images) the handler attached to the original
      // content — the facet projector only emits text/markup/query blocks today.
      const shotOf = screenshotTargetOf(m);
      const superseded = shotOf !== undefined && latestShotIdx.get(shotOf) !== i;
      const origNonText = superseded
        ? []
        : (Array.isArray(m.content) ? m.content : []).filter((c) => c.type !== 'text');
      const stubBlocks: TextContent[] = superseded
        ? [{ type: 'text', text: SUPERSEDED_SCREENSHOT_STUB }]
        : [];
      return { ...m, content: [...statusBlocks, ...fileBlocks, ...origNonText, ...stubBlocks] };
    }
    return m;
  });
}
