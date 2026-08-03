import type { LLMCallDetail } from '@/lib/chat/chat-types';

export const AppEvents = {
  FILE_CREATED:             'file:created',
  FILE_VIEWED:              'file:viewed',
  FILE_VIEWED_AS_REFERENCE: 'file:viewed_as_reference',
  FILE_UPDATED:             'file:updated',
  FILE_DELETED:             'file:deleted',
  LLM_CALL:                 'llm:call',
  QUERY_EXECUTED:           'query:executed',
  ERROR:                    'error',
  JOB_CRON_SUCCEEDED:       'job:cron_succeeded',
  JOB_CRON_FAILED:          'job:cron_failed',
  USER_MESSAGE:             'user:message',
  MCP_TOOL_CALL:            'mcp:tool_call',
  REMOTE_TOOL_CALL:         'remote:tool_call',
  USER_LOGGED_IN:           'user:login',
  USER_CREATED:             'user:created',
  USER_DELETED:             'user:deleted',
  FEEDBACK:                 'user:feedback',
  SHARE_LEAD:               'share:lead',
  SHARE_OPEN:               'share:open',
  // Credit management: a user was blocked by an enforced limit; and a credit
  // window was reset (manual by an admin, or the automatic weekly boundary).
  RATE_LIMIT_HIT:           'credit:rate_limit_hit',
  CREDIT_RESET:             'credit:reset',
  // Audit trail for privileged / previously-silent mutations. `config:updated`
  // is the highest-privilege write in the app (LLM keys, accessRules, credit
  // policy); connection lifecycle (updates ride FILE_UPDATED with
  // fileType 'connection' — creation/deletion get their own events); share
  // links minted/revoked; a user row mutated (role/2FA/home_folder — creation
  // and deletion already have events); destructive admin operations.
  CONFIG_UPDATED:           'config:updated',
  CONNECTION_CREATED:       'connection:created',
  CONNECTION_DELETED:       'connection:deleted',
  SHARE_CREATED:            'share:created',
  SHARE_REVOKED:            'share:revoked',
  USER_UPDATED:             'user:updated',
  ADMIN_ACTION:             'admin:action',
  // One event per chat turn segment: how it ended and how long it took — the
  // turn runner is detached from the HTTP request, so nothing else sees this.
  CHAT_TURN:                'chat:turn',
} as const;

export type AppEventName = typeof AppEvents[keyof typeof AppEvents];

interface BaseEventPayload {
  mode: string;
}

export interface AppEventPayloads {
  'file:created':             BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed':              BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed_as_reference': BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string; referencedByFileId: number; referencedByFileType?: string };
  'file:updated':             BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:deleted':             BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  // `conversationId` is present for conversation-bound turns (chat UI / onboarding);
  // headless one-shot runs (feed-summary, micro-tasks, …) omit it and set `task`
  // instead so usage can be sliced by use-case without a conversation.
  'llm:call':                 BaseEventPayload & { conversationId?: number; task?: string; llmCalls: Record<string, LLMCallDetail>; userId?: number; userEmail?: string; userRole?: string };
  'query:executed':           BaseEventPayload & { queryHash: string; fileId?: number | null; fileVersion?: number | null; query?: string; params?: Record<string, unknown>; schemaContext?: Array<{ schema: string; table: string; columns: string[] }>; databaseName: string | null; durationMs: number; rowCount: number; colCount?: number; wasCacheHit: boolean; error?: string | null; userId?: number; userEmail?: string | null };
  'error':                    BaseEventPayload & { source: string; message: string; error?: unknown; context?: Record<string, unknown> };
  'job:cron_succeeded':       BaseEventPayload & { triggered: number; skipped: number };
  'job:cron_failed':          BaseEventPayload & { triggered: number; skipped: number; failed: number };
  'user:message':             BaseEventPayload & { source: 'explore' | 'side_chat' | 'slack' | 'mcp'; conversationId?: number; userId?: number; userEmail?: string; messagePreview?: string };
  'mcp:tool_call':            BaseEventPayload & { sessionId: string; tool: string; userId?: number; userEmail?: string };
  // Remote Agent Sessions: one event per externally-authored tool call (audit/metering — the
  // per-LLM-call credit gate never fires in a remote session; LLM cost is the external agent's).
  'remote:tool_call':         BaseEventPayload & { conversationId: number; tool: string; durationMs: number; isError: boolean; pending: boolean; userId?: number; userEmail?: string };
  'user:login':               BaseEventPayload & { userId?: number; userEmail?: string; role?: string };
  'user:created':             BaseEventPayload & { userId?: number; userEmail?: string; role?: string; createdBy?: string };
  'user:deleted':             BaseEventPayload & { userId?: number; userEmail?: string; role?: string; deletedBy?: string };
  'user:feedback':            BaseEventPayload & { conversationId: number; userMessageLogIndex: number; rating: 'positive' | 'negative'; tags: string[]; comment?: string; userId?: number; userEmail?: string };
  // Anonymous guest submitted name/email on a public share (lead capture).
  // `userEmail` mirrors `email` for consistency with other events' attribution.
  'share:lead':               BaseEventPayload & { fileId: number; nonce: string; storyName: string; name: string; email: string; userEmail: string; folderPath: string };
  // First open of a public share by a new visitor. `anonymous` = no lead captured.
  'share:open':               BaseEventPayload & { fileId: number; nonce: string; storyName: string; folderPath: string; anonymous: boolean; uid: number; userEmail?: string };
  // A user hit an enforced credit limit (0-token usage event for auditing).
  'credit:rate_limit_hit':    BaseEventPayload & { userId?: number; userEmail?: string; userRole?: string; window?: 'reset' | 'billing' };
  // A credit window was reset. `scope`+`target` say what was reset (a user id,
  // a role name, or 'company'); `auto` marks the weekly-boundary auto-reset.
  'credit:reset':             BaseEventPayload & { scope: 'user' | 'role' | 'company'; target: string; auto?: boolean; actorUserId?: number; actorEmail?: string };
  // Org config saved (Settings / setup wizard). `changedKeys` = the TOP-LEVEL
  // OrgConfig sections present in the incoming partial — never values, which may
  // hold credentials even though secrets are extracted before persistence.
  'config:updated':           BaseEventPayload & { configId: number; changedKeys: string[]; userId?: number; userEmail?: string; userRole?: string };
  'connection:created':       BaseEventPayload & { connectionName: string; connectionType?: string; userId?: number; userEmail?: string; userRole?: string };
  'connection:deleted':       BaseEventPayload & { connectionName: string; userId?: number; userEmail?: string; userRole?: string };
  // Share-link lifecycle (minted/revoked by an admin). The guest-side events
  // (share:open / share:lead) already exist above.
  'share:created':            BaseEventPayload & { fileId: number; nonce: string; label?: string; userId?: number; userEmail?: string; userRole?: string };
  'share:revoked':            BaseEventPayload & { fileId: number; nonce: string; userId?: number; userEmail?: string; userRole?: string };
  // A user row was mutated (role/2FA/home_folder/password). `changedFields` =
  // field NAMES only, never values. `userId`/`userEmail` = the TARGET user;
  // `updatedBy` = the acting user's email.
  'user:updated':             BaseEventPayload & { userId?: number; userEmail?: string; role?: string; changedFields: string[]; updatedBy?: string };
  // Destructive / high-privilege admin operations (data import, DB migration,
  // tutorial reset, cache clear, LLM-log purge). `action` is a stable slug.
  'admin:action':             BaseEventPayload & { action: string; details?: Record<string, unknown>; userId?: number; userEmail?: string; userRole?: string };
  // One event per chat turn segment, published by the detached turn runner
  // (nothing else observes turn outcomes — `withAuth` never sees them).
  'chat:turn':                BaseEventPayload & { conversationId: number; status: 'ok' | 'error' | 'paused'; durationMs: number; source?: string | null; error?: string; userId?: number; userEmail?: string };
}
