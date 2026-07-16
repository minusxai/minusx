/**
 * Conversations V2 — display-grade wire projection (see /conversations-v2.md).
 *
 * The stored pi log is the LLM's channel (full replay fidelity). The browser only needs
 * display-grade data, so the conversation read routes project each entry through
 * `projectLogEntryForDisplay` unless the client asks for `view=full` (dev mode).
 *
 * Contract: `content` is the LLM's channel, `details` is the client's channel.
 *
 * Invariants (the client depends on these):
 *  - Entry COUNT, ORDER, ids, `parent_id`, and timestamps are preserved — `piLog.length` is the
 *    client's `log_index` (resume/fork/interrupt) and pending frontend-tool derivation matches
 *    toolCall block ids. Entries are shrunk, never dropped.
 *  - Assistant entries keep their content blocks (reply text, thinking, toolCall blocks — tool
 *    displays read args from them); `usage` (debug-only) is dropped.
 *  - Projection is idempotent: projecting an already-projected entry is a no-op.
 *
 * Pure module: no `server-only` import (unit-testable), but only server routes should use it.
 */
import type { ConversationLogEntry } from '@/orchestrator/types';
import type { MessageRow } from './conversations.types';

/** Wire views for conversation reads. `display` (default) is slim; `full` is the verbatim log. */
export type ConversationView = 'display' | 'full';

/** Parse a `?view=` query value; anything but 'full' (including null) is 'display'. */
export function parseConversationView(raw: string | null | undefined): ConversationView {
  return raw === 'full' ? 'full' : 'display';
}

/** Cap for display-grade derived details / kept diffs (chars of JSON/string). */
export const DISPLAY_DETAILS_CAP_CHARS = 32_000;
/** Conservative cap for unknown-tool result content kept on the wire. */
export const DISPLAY_UNKNOWN_CONTENT_CAP_CHARS = 8_000;

/**
 * ToolResults whose displays render purely from `details` (diff, screenshotUrl, queryResult):
 * their `content` (LLM-only image blocks / status echoes / result markdown) is dropped entirely.
 */
export const DETAILS_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'EditFile',
  'ReviewFile',
  'Screenshot',
  'ExecuteQuery',
]);

/**
 * ToolResults whose displays parse the result text today (their tools don't populate `details`):
 * display-grade `details` is DERIVED from `content` at read time (parse + cap), then `content`
 * is dropped. Works retroactively for existing conversations — no write-path change.
 */
export const DERIVE_DETAILS_TOOLS: ReadonlySet<string> = new Set([
  'SearchDBSchema',
  'SearchFiles',
  'ReadFiles',
  'CreateFile',
  'FuzzyMatch',
  'ExploreDataset',
  'ListDBConnections',
  'PublishAll',
  'LoadContext',
  'LoadSkill',
  'Clarify',
  'Navigate',
]);

/**
 * Context keys kept on toolCall (agent invocation) entries in the display view. Everything else
 * (`appState`, `resolvedContextDocs`, `schema`, `whitelistedTables`, user/mode plumbing) is
 * dev-inspector data and is stripped.
 */
export const DISPLAY_CONTEXT_KEYS: ReadonlySet<string> = new Set(['currentTime', 'attachments']);

type AnyEntry = Record<string, unknown>;

/** Keep only text blocks, truncated to a total character budget; image/binary blocks are dropped. */
function capTextBlocks(content: unknown, cap: number): unknown {
  if (!Array.isArray(content)) return content;
  const out: unknown[] = [];
  let budget = cap;
  for (const block of content) {
    const b = block as { type?: string; text?: string };
    if (b?.type !== 'text' || typeof b.text !== 'string') continue; // images etc. are LLM-only
    if (budget <= 0) break;
    out.push(b.text.length <= budget ? b : { ...b, text: b.text.slice(0, budget) });
    budget -= Math.min(b.text.length, budget);
  }
  return out;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content
    .filter((b): b is { type: 'text'; text: string } => (b as { type?: string })?.type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Display-grade `details` for a derive-details tool: the parsed JSON result payload (what the
 * tool card renders), or a capped `{ text }` when the result isn't JSON. Capped as a whole so a
 * pathological result can't smuggle megabytes back onto the wire.
 */
function deriveDetailsFromContent(content: unknown): unknown {
  const text = textOf(content);
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === 'object') {
      if (JSON.stringify(parsed).length <= DISPLAY_DETAILS_CAP_CHARS) return parsed;
      const success = (parsed as { success?: unknown }).success;
      return { ...(success !== undefined ? { success } : {}), __truncated: true, text: text.slice(0, DISPLAY_DETAILS_CAP_CHARS) };
    }
  } catch { /* not JSON — fall through to capped text */ }
  return { text: text.slice(0, DISPLAY_DETAILS_CAP_CHARS) };
}

/** Details-only tools: drop the LLM-facing `__status` echo and cap oversized diffs. */
function slimDetails(details: unknown): unknown {
  if (details === null || typeof details !== 'object') return details;
  const { __status, ...rest } = details as AnyEntry & { __status?: unknown };
  void __status;
  if (typeof rest.diff === 'string' && rest.diff.length > DISPLAY_DETAILS_CAP_CHARS) {
    rest.diff = rest.diff.slice(0, DISPLAY_DETAILS_CAP_CHARS);
  }
  return rest;
}

function projectInvocation(entry: AnyEntry): AnyEntry {
  const ctx = entry.context;
  if (ctx === null || typeof ctx !== 'object') return entry;
  const kept: AnyEntry = {};
  for (const key of DISPLAY_CONTEXT_KEYS) {
    if (key in (ctx as AnyEntry)) kept[key] = (ctx as AnyEntry)[key];
  }
  return { ...entry, context: kept };
}

function projectAssistant(entry: AnyEntry): AnyEntry {
  const { usage, diagnostics, ...rest } = entry as AnyEntry & { usage?: unknown; diagnostics?: unknown };
  void usage; void diagnostics;
  return rest;
}

function projectToolResult(entry: AnyEntry): AnyEntry {
  const toolName = String(entry.toolName ?? '');
  // Failures keep their (text) error message — the card renders it — but never inline images.
  if (entry.isError === true) {
    return { ...entry, content: capTextBlocks(entry.content, DISPLAY_UNKNOWN_CONTENT_CAP_CHARS) };
  }
  if (DETAILS_ONLY_TOOLS.has(toolName)) {
    return { ...entry, content: [], details: slimDetails(entry.details) };
  }
  if (DERIVE_DETAILS_TOOLS.has(toolName)) {
    const details = entry.details !== undefined ? entry.details : deriveDetailsFromContent(entry.content);
    return { ...entry, content: [], ...(details !== undefined ? { details } : {}) };
  }
  return { ...entry, content: capTextBlocks(entry.content, DISPLAY_UNKNOWN_CONTENT_CAP_CHARS) };
}

/**
 * Project one stored pi log entry to its display-grade form. Never changes entry kind, id,
 * `parent_id`, or timestamps; never returns null.
 */
export function projectLogEntryForDisplay(entry: ConversationLogEntry): ConversationLogEntry {
  const e = entry as unknown as AnyEntry;
  let projected: AnyEntry;
  if (e.type === 'toolCall') projected = projectInvocation(e);
  else if (e.role === 'assistant') projected = projectAssistant(e);
  else if (e.role === 'toolResult') projected = projectToolResult(e);
  else projected = e;
  return projected as unknown as ConversationLogEntry;
}

/**
 * Project a message row for the display view. `kind: 'error'` rows pass through unchanged;
 * pi rows get `content` projected via `projectLogEntryForDisplay`.
 */
export function projectMessageRowForDisplay(row: MessageRow): MessageRow {
  if (row.kind === 'error') return row;
  return { ...row, content: projectLogEntryForDisplay(row.content) };
}
