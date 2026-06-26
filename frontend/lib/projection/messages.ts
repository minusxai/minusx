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
import { projectFiles } from './project';
import { renderProjectedFiles } from './render';
import type { AugmentedFiles } from './types';

/** Non-wire marker: the page context a user message was sent with (for app-state projection). */
export interface WithAppState {
  _appState?: AppState;
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
  const stripEntry = (e: AugmentedFiles['file']) =>
    e.queryResults?.length
      ? { ...e, queryResults: e.queryResults.map(({ data: _drop, ...qr }) => qr) }
      : e;
  return { file: stripEntry(files.file), references: files.references.map(stripEntry) };
}

/** Render the app-state blocks for one user turn, advancing the memo. File pages go through the
 *  facet projector (summary only — no row data); folder/explore render their JSON inline. */
function renderAppState(memo: FacetMemo, appState: AppState | undefined): (TextContent | ImageContent)[] {
  if (appState?.type === 'file' && appState.state) {
    const files: AugmentedFiles = stripQueryData(compressedToAugmentedFiles(appState.state));
    return renderProjectedFiles(projectFiles(memo, files), { jsonTag: 'AppState' });
  }
  const json = appState !== undefined ? JSON.stringify(appStateForLlm(appState)) : 'null';
  return [{ type: 'text', text: `<AppState>${json}</AppState>` }];
}

export function projectMessages(messages: Message[]): Message[] {
  const memo = new FacetMemo();
  return messages.map((m): Message => {
    if (m.role === 'user') {
      const appState = (m as Message & WithAppState)._appState;
      if (appState === undefined) return m;
      const blocks = renderAppState(memo, appState);
      const rest: (TextContent | ImageContent)[] =
        typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      const { _appState: _omit, ...clean } = m as Message & WithAppState;
      return { ...clean, content: [...blocks, ...rest] } as Message;
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
      const origNonText = (Array.isArray(m.content) ? m.content : []).filter((c) => c.type !== 'text');
      return { ...m, content: [...statusBlocks, ...fileBlocks, ...origNonText] };
    }
    return m;
  });
}
