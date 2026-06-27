/**
 * Chat Architecture v3 — server-side conversation/message store (the data layer).
 *
 * The source of truth for chat. Conversations and their pi log live in two tables
 * (`conversations`, `messages`); `messages.content` is each pi entry verbatim and `messages.seq`
 * is the 0-based log index + stream cursor. Errors share `messages` as `kind='error'` rows with
 * seq=NULL (the parallel error stream, kept out of the pi log). This module owns:
 *   - shared-id allocation (conversation ids share the global files id-space, see allocateId)
 *   - create / get / list / delete conversations
 *   - append (OCC via UNIQUE(conversation_id, seq)) + load of the pi log
 *   - the parallel error stream
 *
 * Direct DB access is confined here (the data layer). Routes/orchestrator go through these fns.
 */
import { getModules } from '@/lib/modules/registry';
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';
import { entriesToInserts, rowsToLog } from './conversation-log';
import type {
  Conversation,
  ConversationErrorRow,
  ConversationMeta,
  MessageKind,
  MessageRow,
  RunStatus,
} from './conversations.types';

const db = () => getModules().db;

/** Concurrent-append collision (another writer took this seq) → the caller forks. */
export class ConcurrentAppendError extends Error {
  constructor(conversationId: number, seq: number) {
    super(`messages seq ${seq} already exists for conversation ${conversationId}`);
    this.name = 'ConcurrentAppendError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === '23505' || /unique constraint|duplicate key/i.test(String(e.message ?? ''));
}

/** jsonb columns come back parsed on Postgres but may be strings on some paths — coerce defensively. */
function asJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

interface ConversationRow {
  id: number; owner_user_id: number; mode: string; title: string; agent: string;
  run_status: string; run_lease_owner: string | null; run_heartbeat_at: string | null;
  run_started_seq: number | null; meta: unknown; forked_from: number | null;
  created_at: string; updated_at: string;
}

function mapConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    ownerUserId: r.owner_user_id,
    mode: r.mode,
    title: r.title,
    agent: r.agent,
    runStatus: r.run_status as RunStatus,
    runLeaseOwner: r.run_lease_owner,
    runHeartbeatAt: r.run_heartbeat_at,
    runStartedSeq: r.run_started_seq,
    meta: asJson<ConversationMeta>(r.meta ?? {}),
    forkedFrom: r.forked_from,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface MessageDbRow {
  id: number; conversation_id: number; seq: number | null; kind: string;
  pi_id: string | null; parent_pi_id: string | null; content: unknown; created_at: string;
}

function mapMessage(r: MessageDbRow): MessageRow {
  return {
    id: Number(r.id),
    conversationId: r.conversation_id,
    seq: r.seq,
    kind: r.kind as MessageKind,
    piId: r.pi_id,
    parentPiId: r.parent_pi_id,
    content: asJson<ConversationLogEntry>(r.content),
    createdAt: r.created_at,
  };
}

// ── conversations ───────────────────────────────────────────────────────────

export interface CreateConversationOpts {
  ownerUserId: number;
  mode: string;
  agent: string;
  title?: string;
  meta?: ConversationMeta;
  forkedFrom?: number;
  /** Allocate this exact id (backfill: preserve the old file id). Default: shared-space allocator. */
  explicitId?: number;
}

/**
 * Create a conversation. The id shares the global files id-space: it's the max over BOTH files and
 * conversations (≥1000) + 1, taken under the same advisory lock (1) the files allocator uses — so a
 * new conversation id never collides with a file id or another conversation, and the backfill can
 * insert old conversations with their existing id (`explicitId`).
 */
export async function createConversation(opts: CreateConversationOpts): Promise<Conversation> {
  const meta: ConversationMeta = { version: 3, ...(opts.meta ?? {}) };
  const title = opts.title ?? 'New Conversation';
  const params = [opts.ownerUserId, opts.mode, title, opts.agent, JSON.stringify(meta), opts.forkedFrom ?? null];

  const sql = opts.explicitId != null
    ? `INSERT INTO conversations (id, owner_user_id, mode, title, agent, meta, forked_from)
       VALUES (${Number(opts.explicitId)}, $1, $2, $3, $4, $5::jsonb, $6) RETURNING *`
    : `WITH lock AS (SELECT pg_advisory_xact_lock(1)),
            nid AS (
              SELECT GREATEST(
                COALESCE((SELECT MAX(id) FROM files), 0),
                COALESCE((SELECT MAX(id) FROM conversations), 0),
                999
              ) + 1 AS next_id
            )
       INSERT INTO conversations (id, owner_user_id, mode, title, agent, meta, forked_from)
       SELECT next_id, $1, $2, $3, $4, $5::jsonb, $6 FROM nid, lock RETURNING *`;

  const res = await db().exec<ConversationRow>(sql, params);
  return mapConversation(res.rows[0]);
}

export async function getConversation(id: number): Promise<Conversation | null> {
  const res = await db().exec<ConversationRow>('SELECT * FROM conversations WHERE id = $1', [id]);
  return res.rows[0] ? mapConversation(res.rows[0]) : null;
}

/**
 * Find a conversation id by a top-level `meta` string field (e.g. the Slack thread key). Used for
 * idempotent get-or-create of headless conversations that don't have a stable surrogate key.
 */
export async function findConversationIdByMeta(metaKey: string, value: string): Promise<number | null> {
  const res = await db().exec<{ id: number }>(
    `SELECT id FROM conversations WHERE meta->>$1 = $2 ORDER BY id LIMIT 1`,
    [metaKey, value],
  );
  return res.rows[0]?.id ?? null;
}

export async function listConversations(
  ownerUserId: number,
  mode: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<Conversation[]> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;
  const res = await db().exec<ConversationRow>(
    `SELECT * FROM conversations WHERE owner_user_id = $1 AND mode = $2
     ORDER BY updated_at DESC LIMIT $3 OFFSET $4`,
    [ownerUserId, mode, limit, offset],
  );
  return res.rows.map(mapConversation);
}

export async function updateConversationTitle(id: number, title: string): Promise<void> {
  await db().exec('UPDATE conversations SET title = $2 WHERE id = $1', [id, title]);
}

export async function setRunStatus(id: number, status: RunStatus): Promise<void> {
  await db().exec('UPDATE conversations SET run_status = $2 WHERE id = $1', [id, status]);
}

/** Lease TTL: a 'running' conversation whose heartbeat is older than this is considered orphaned
 *  (the server that owned the turn died). */
export const RUN_LEASE_TTL_MS = 90_000;

/** Claim the active turn: status running + owner + heartbeat now + the seq it started at. */
export async function acquireRunLease(id: number, owner: string, startedSeq: number): Promise<void> {
  await db().exec(
    `UPDATE conversations SET run_status = 'running', run_lease_owner = $2, run_heartbeat_at = NOW(), run_started_seq = $3 WHERE id = $1`,
    [id, owner, startedSeq],
  );
}

/** Bump the heartbeat while the turn runs (only if we still hold the lease). */
export async function heartbeatRunLease(id: number, owner: string): Promise<void> {
  await db().exec(
    `UPDATE conversations SET run_heartbeat_at = NOW() WHERE id = $1 AND run_lease_owner = $2`,
    [id, owner],
  );
}

/** Release the lease and set the terminal status. */
export async function releaseRunLease(id: number, status: RunStatus): Promise<void> {
  await db().exec(
    `UPDATE conversations SET run_status = $2, run_lease_owner = NULL, run_heartbeat_at = NULL WHERE id = $1`,
    [id, status],
  );
}

/** True when a conversation claims to be running but its heartbeat has gone stale (owner died). */
export function isRunLeaseStale(conv: { runStatus: RunStatus; runHeartbeatAt: string | null }, now = Date.now()): boolean {
  if (conv.runStatus !== 'running') return false;
  if (!conv.runHeartbeatAt) return true; // running with no heartbeat → orphaned
  return now - (Date.parse(conv.runHeartbeatAt) || 0) > RUN_LEASE_TTL_MS;
}

export async function deleteConversation(id: number): Promise<void> {
  // messages (pi-log + error rows) cascade via FK ON DELETE CASCADE.
  await db().exec('DELETE FROM conversations WHERE id = $1', [id]);
}

/**
 * Fork a conversation at `atSeq`: create a NEW conversation (own id) copying messages [0, atSeq) from
 * the source, with `meta.forkedFrom` set. Powers edit-and-fork — the caller then runs the edited
 * turn on the fork. The source is untouched.
 */
export async function forkConversation(sourceId: number, atSeq: number): Promise<Conversation> {
  const src = await getConversation(sourceId);
  if (!src) throw new Error(`fork source conversation ${sourceId} not found`);
  const created = await createConversation({
    ownerUserId: src.ownerUserId,
    mode: src.mode,
    agent: src.agent,
    title: src.title,
    meta: { ...src.meta, version: 3, forkedFrom: sourceId },
  });
  const rows = await loadMessages(sourceId);
  // loadMessages already excludes error rows (seq IS NULL), but guard for the nullable type.
  const slice = rows.filter((r) => r.seq != null && r.seq < atSeq).map((r) => r.content) as ConversationLog;
  if (slice.length > 0) await appendMessages(created.id, slice, 0);
  return created;
}

// ── messages ──────────────────────────────────────────────────────────────────

/** Highest committed seq for a conversation, or -1 when empty (so the next append is seq 0). */
export async function getMaxSeq(conversationId: number): Promise<number> {
  const res = await db().exec<{ max_seq: number | null }>(
    'SELECT MAX(seq) AS max_seq FROM messages WHERE conversation_id = $1',
    [conversationId],
  );
  const m = res.rows[0]?.max_seq;
  return m == null ? -1 : Number(m);
}

/**
 * Append pi entries to the log starting at `startSeq` (the expected next index). OCC is enforced by
 * UNIQUE(conversation_id, seq): if a concurrent writer already took a seq, the insert throws and we
 * surface a {@link ConcurrentAppendError} for the caller to fork. Returns the inserted rows.
 */
export async function appendMessages(
  conversationId: number,
  entries: ConversationLog,
  startSeq: number,
): Promise<MessageRow[]> {
  if (entries.length === 0) return [];
  const inserts = entriesToInserts(entries, startSeq);

  // One multi-row INSERT. $1 = conversation_id; each row contributes 5 params.
  const params: unknown[] = [conversationId];
  const valuesSql = inserts
    .map((row, i) => {
      const b = 2 + i * 5; // first row params start at $2
      params.push(row.seq, row.kind, row.piId, row.parentPiId, JSON.stringify(row.content));
      return `($1, $${b}, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb)`;
    })
    .join(', ');

  try {
    const res = await db().exec<MessageDbRow>(
      `INSERT INTO messages (conversation_id, seq, kind, pi_id, parent_pi_id, content)
       VALUES ${valuesSql} RETURNING *`,
      params,
    );
    // Touch the conversation so list ordering (updated_at DESC) reflects activity.
    await db().exec('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [conversationId]);
    return res.rows.map(mapMessage);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConcurrentAppendError(conversationId, startSeq);
    throw error;
  }
}

/** Load message rows (optionally only those past `sinceSeq`), ordered by seq — for API + stream catch-up. */
export async function loadMessages(conversationId: number, sinceSeq = -1): Promise<MessageRow[]> {
  const res = await db().exec<MessageDbRow>(
    'SELECT * FROM messages WHERE conversation_id = $1 AND seq > $2 ORDER BY seq',
    [conversationId, sinceSeq],
  );
  return res.rows.map(mapMessage);
}

/**
 * Rebuild the pi ConversationLog the orchestrator consumes. Only seq-bearing rows are pi-log
 * entries — `kind='error'` rows have seq=NULL and are excluded (they're the parallel error stream).
 */
export async function loadLog(conversationId: number): Promise<ConversationLog> {
  const res = await db().exec<{ content: unknown }>(
    'SELECT content FROM messages WHERE conversation_id = $1 AND seq IS NOT NULL ORDER BY seq',
    [conversationId],
  );
  return rowsToLog(res.rows.map((r) => ({ content: asJson<ConversationLogEntry>(r.content) })));
}

// ── parallel error stream (kind='error' rows in messages; seq=NULL so they stay out of the pi log) ──

export async function appendError(
  conversationId: number,
  err: { source: string; message: string; parentPiId?: string | null; details?: Record<string, unknown> | null },
): Promise<void> {
  // seq=NULL keeps the error out of the contiguous pi-log index; the payload lives in content.
  const content = { source: err.source, message: err.message, details: err.details ?? null };
  await db().exec(
    `INSERT INTO messages (conversation_id, seq, kind, pi_id, parent_pi_id, content)
     VALUES ($1, NULL, 'error', NULL, $2, $3::jsonb)`,
    [conversationId, err.parentPiId ?? null, JSON.stringify(content)],
  );
}

export async function loadErrors(conversationId: number): Promise<ConversationErrorRow[]> {
  const res = await db().exec<{
    id: number; conversation_id: number; parent_pi_id: string | null; content: unknown; created_at: string;
  }>(
    `SELECT id, conversation_id, parent_pi_id, content, created_at
       FROM messages WHERE conversation_id = $1 AND kind = 'error' ORDER BY created_at, id`,
    [conversationId],
  );
  return res.rows.map((r) => {
    const c = asJson<{ source?: string; message?: string; details?: Record<string, unknown> | null }>(r.content) ?? {};
    return {
      id: Number(r.id),
      conversationId: r.conversation_id,
      source: c.source ?? 'unhandled',
      message: c.message ?? '',
      parentPiId: r.parent_pi_id,
      details: c.details ?? null,
      createdAt: r.created_at,
    };
  });
}
