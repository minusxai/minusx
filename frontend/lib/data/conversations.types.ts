/**
 * Chat Architecture v3 — conversation/message types.
 *
 * Conversations are first-class rows (not files). The `messages` table holds one row per pi
 * ConversationLogEntry; `content` is the entry verbatim (source of truth) and `seq` is both the
 * 0-based pi log index and the stream cursor. See docs/chat-architecture-v3.md.
 */
import type { ConversationLogEntry } from '@/orchestrator/types';
import type { RemoteSessionRecord } from './remote-sessions.types';

/** A frontend-bridged tool call the client must execute (derived from the committed log). */
export interface StreamPendingToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 'remote' = an external agent holds the conversation (Remote Agent Session). Unlike 'running'
 * it is NOT lease/heartbeat-bearing — liveness is judged from `meta.remoteSession` (TTL + idle),
 * lazily released by whichever reader observes expiry. See REMOTE_AGENT_SESSIONS.md.
 */
export type RunStatus = 'idle' | 'running' | 'paused' | 'error' | 'remote';

export interface ConversationMeta {
  /** Schema version tag; 3 for v3 conversations. */
  version?: number;
  /** Full (untruncated) first user message — used for renaming/search. */
  firstMessage?: string;
  /** Parent conversation id when this row was created by an OCC fork. */
  forkedFrom?: number;
  /** Consecutive silent auto-retries of the current turn after server-restart interruptions (cap: MAX_AUTO_RETRIES). */
  autoRetries?: number;
  /** True once an AI-generated title has been written to `title` (vs the raw first message). */
  titleGenerated?: boolean;
  /** Live/most-recent Remote Agent Session for this conversation (see remote-sessions.types). */
  remoteSession?: RemoteSessionRecord;
  [key: string]: unknown;
}

/** A conversation row, mapped to camelCase. */
export interface Conversation {
  id: number;
  ownerUserId: number;
  mode: string;
  title: string;
  agent: string;
  runStatus: RunStatus;
  runLeaseOwner: string | null;
  runHeartbeatAt: string | null;
  runStartedSeq: number | null;
  meta: ConversationMeta;
  forkedFrom: number | null;
  createdAt: string;
  updatedAt: string;
}

// pi-log kinds carry a contiguous `seq`; 'error' rows are the parallel error stream (seq = null).
export type MessageKind = 'toolCall' | 'assistant' | 'toolResult' | 'error';

/** A message row, mapped to camelCase. `content` is the verbatim pi log entry (or, for kind='error', { source, message, details }). */
export interface MessageRow {
  id: number;
  conversationId: number;
  seq: number | null;
  kind: MessageKind;
  piId: string | null;
  parentPiId: string | null;
  content: ConversationLogEntry;
  createdAt: string;
}

export interface ConversationErrorRow {
  id: number;
  conversationId: number;
  source: string;
  message: string;
  parentPiId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * SSE wire envelope for the resumable stream (`GET /api/conversations/:id/stream`).
 * Every event that advances the log carries `seq` so a reconnecting client resumes exactly.
 */
export type ConversationStreamEvent =
  | { type: 'message'; seq: number; message: ConversationLogEntry } // a durable, committed entry
  | { type: 'delta'; seq: number; text: string; thinking?: boolean } // ephemeral token chunk (in-flight msg); thinking=true ⇒ reasoning tokens, render under the thinking affordance, never as reply text
  | { type: 'pending'; seq: number; toolCalls: StreamPendingToolCall[] } // turn paused on a frontend tool
  | { type: 'status'; runStatus: RunStatus; retryable?: boolean }   // run lifecycle transition; retryable=true on a crash-interrupted error the client may silently re-run
  | { type: 'done'; seq: number }                                  // turn finished; cursor is final
  | { type: 'error'; error: string };

/** Payload carried by the LISTEN/NOTIFY wakeup — a pointer only (NOTIFY payload is ~8KB capped). */
export interface ConversationNotify {
  /** Highest committed message seq, or the in-flight seq for a delta. */
  seq: number;
  /** 'message' = new committed row(s) to SELECT; 'delta' = ephemeral text chunk; 'status' = run change;
   *  'interrupt' = a Stop request the active turn should honor (cancel the orchestrator). */
  kind: 'message' | 'delta' | 'status' | 'interrupt';
  /** For delta notifies, the (small) text chunk rides inline. */
  text?: string;
  /** Delta notifies only: true when the chunk is REASONING (thinking) tokens, not reply text. */
  thinking?: boolean;
  runStatus?: RunStatus;
}
