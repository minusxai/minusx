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
