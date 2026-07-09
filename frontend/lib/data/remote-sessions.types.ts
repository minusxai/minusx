/**
 * Remote Agent Sessions ("Copy to Agent") — shared types.
 *
 * A remote session lets an external agent (e.g. Claude Code) drive one conversation over
 * plain HTTP, replacing the LLM as the tool-call decider. The session is scoped to a single
 * conversation and authorized by a bearer capability code (`/s/<code>`); only a hash of the
 * code's nonce is stored. See REMOTE_AGENT_SESSIONS.md at the repo root for the full design.
 *
 * Client-safe: types only, no server imports.
 */

/** Per-session record persisted under `conversations.meta.remoteSession`. */
export interface RemoteSessionRecord {
  /** sha256(nonce) hex — compared via timingSafeEqual; the nonce itself is never stored. */
  nonceHash: string;
  createdAt: string;
  /** Hard TTL — the session is dead past this instant regardless of activity. */
  expiresAt: string;
  /** Bumped on every authenticated remote request; drives the idle timeout. */
  lastActivityAt: string;
  /** Idle timeout baked into the record at mint so liveness checks are pure data. */
  idleTimeoutMs: number;
  /** Soft revoke (Stop button, agent /end, re-mint) — like ShareRecord.revoked. */
  revoked?: boolean;
  /** userId that minted (== conversation.ownerUserId). */
  createdBy: number;
  /** Names the exposed leaf-tool list (currently always 'remote-session'). */
  toolset: string;
}

export type RemoteSessionDenial =
  | 'not_found'
  | 'revoked'
  | 'expired'
  | 'idle_expired';

/** Result content block on the remote wire — the orchestrator's own content, serialized. */
export type RemoteContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'image'; data: string; mimeType: string };

/** POST /s/<code>/tool — request body. */
export interface RemoteToolCallRequest {
  /** Must be in the session's leaf-tool allowlist. */
  tool: string;
  /** Validated against the tool's TypeBox schema. */
  args: Record<string, unknown>;
  /** Optional idempotency key supplied by the agent; becomes the toolCallId. */
  callId?: string;
}

/** 200: the tool completed within the long-poll window. */
export interface RemoteToolCallCompleted {
  status: 'completed';
  toolCallId: string;
  /** Tool-level failure (recoverable by the agent) — distinct from protocol errors. */
  isError: boolean;
  content: RemoteContentBlock[];
}

/** 202: still executing in the user's browser — poll GET /s/<code>/result/<toolCallId>. */
export interface RemoteToolCallPending {
  status: 'pending';
  toolCallId: string;
  pollAfterMs: number;
}

export type RemoteToolCallResponse = RemoteToolCallCompleted | RemoteToolCallPending;

/** GET /s/<code>/context — orientation snapshot for the external agent. */
export interface RemoteSessionContext {
  conversationId: number;
  mode: string;
  agentName: string;
  connections: { name: string; dialect: string }[];
  toolNames: string[];
}

/** POST /api/conversations/:id/remote-session — mint response. */
export interface RemoteSessionMintResult {
  url: string;
  code: string;
  expiresAt: string;
  /** Exact clipboard payload for the Copy-to-Agent button. */
  copyText: string;
}

/** GET /api/conversations/:id/remote-session — status for the UI banner. */
export interface RemoteSessionStatus {
  active: boolean;
  expiresAt?: string;
  lastActivityAt?: string;
}
