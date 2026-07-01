/**
 * Pure mapping between the orchestrator's pi ConversationLog and `messages` rows.
 *
 * The DB stores one row per pi entry with `content` = the entry verbatim; `seq` is the 0-based log
 * index. These helpers convert in both directions and derive the denormalized columns (kind / pi_id
 * / parent_pi_id) used for querying and threading. Pure + dependency-light so the orchestrator's
 * persistence boundary and the migration can both reuse one source of truth. No DB, no IO.
 */
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';
import type { MessageKind } from './conversations.types';

/** Classify a pi entry: root/sub-agent invocation (`type:'toolCall'`) vs assistant/toolResult. */
export function entryKind(entry: ConversationLogEntry): MessageKind {
  if ((entry as { type?: string }).type === 'toolCall') return 'toolCall';
  const role = (entry as { role?: string }).role;
  return role === 'assistant' ? 'assistant' : 'toolResult';
}

/** The entry's own pi id (thread anchor for invocations); null when the shape has none. */
export function entryPiId(entry: ConversationLogEntry): string | null {
  const id = (entry as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

/** The entry's pi parent_id (null for the root invocation). */
export function entryParentPiId(entry: ConversationLogEntry): string | null {
  const pid = (entry as { parent_id?: unknown }).parent_id;
  return typeof pid === 'string' ? pid : null;
}

/** A row ready to INSERT into `messages` (sans the surrogate `id`/`created_at`). */
export interface MessageInsert {
  seq: number;
  kind: MessageKind;
  piId: string | null;
  parentPiId: string | null;
  content: ConversationLogEntry;
}

/**
 * Convert a slice of pi entries into INSERT-ready rows, numbering them from `startSeq`. Used for both
 * incremental turn appends (startSeq = current log length) and the full backfill (startSeq = 0).
 */
export function entriesToInserts(entries: ConversationLog, startSeq: number): MessageInsert[] {
  return entries.map((entry, i) => ({
    seq: startSeq + i,
    kind: entryKind(entry),
    piId: entryPiId(entry),
    parentPiId: entryParentPiId(entry),
    content: entry,
  }));
}

/** Rebuild the pi ConversationLog from rows (which MUST already be ordered by seq). */
export function rowsToLog(rows: ReadonlyArray<{ content: ConversationLogEntry }>): ConversationLog {
  return rows.map((r) => r.content);
}

/** A tool call the client must execute (frontend-bridged) — derived from the log, no live state. */
export interface DerivedPendingToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Derive the pending tool calls from the committed log: any `toolCall` block inside an assistant
 * message that has no matching `toolResult` is awaiting execution. The orchestrator answers every
 * SERVER tool before it pauses, so what's left unanswered is exactly the frontend-bridged calls the
 * client must run (then POST back as completedToolCalls to resume). Pure — works off rows alone, so
 * the stream can deliver "pending" on reconnect without any live orchestrator state.
 */
/**
 * Frontend tools that pause a run to await USER INPUT (they throw UserInputException) rather than
 * auto-executing in the browser. Keep in sync with the handlers in `lib/api/tool-handlers.ts` that
 * throw UserInputException.
 */
export const USER_INPUT_TOOLS: ReadonlySet<string> = new Set(['ClarifyFrontend', 'Navigate', 'PublishAll']);

/**
 * On COLD LOAD, a `paused` conversation has no live turn/tab driving it. If its unanswered pending
 * tools await USER INPUT (Clarify/Navigate/PublishAll), it's legitimately resumable — the UI renders
 * the prompt. If they're AUTO-EXECUTING tools (EditFile, ReadFiles, …) the original tab was meant to
 * run them and resume, but it's gone — nothing will, so presenting the run as live "executing" (with a
 * Stop button) leaves an old chat spinning forever. This tells the two apart so an orphaned run loads
 * as interrupted instead of live.
 */
export function isAwaitingUserInput(pending: ReadonlyArray<DerivedPendingToolCall>): boolean {
  return pending.some((p) => USER_INPUT_TOOLS.has(p.name));
}

export function derivePendingToolCalls(log: ConversationLog): DerivedPendingToolCall[] {
  const answered = new Set<string>();
  for (const entry of log) {
    const tid = (entry as { toolCallId?: unknown }).toolCallId;
    if ((entry as { role?: string }).role === 'toolResult' && typeof tid === 'string') answered.add(tid);
  }
  const pending: DerivedPendingToolCall[] = [];
  for (const entry of log) {
    if ((entry as { role?: string }).role !== 'assistant') continue;
    const content = (entry as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<{ type?: string; id?: string; name?: string; arguments?: unknown }>) {
      if (block?.type === 'toolCall' && typeof block.id === 'string' && !answered.has(block.id)) {
        pending.push({ id: block.id, name: block.name ?? '', arguments: (block.arguments as Record<string, unknown>) ?? {} });
      }
    }
  }
  return pending;
}
