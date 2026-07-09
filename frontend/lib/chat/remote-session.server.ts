/**
 * Remote Agent Sessions — orchestration side: minting (session-root invocation + context build),
 * ending (revoke + resolve dangling tool calls), and resolving a live session from a bearer code.
 *
 * The session's log entries are exactly what a normal turn would produce (a root `AgentInvocation`
 * for `RemoteSessionAgent`, then assistant/toolResult entries appended via `Orchestrator.dispatch`
 * in the tool endpoint) — so the side chat renders remote activity with zero changes and a later
 * NORMAL turn loads the log cleanly. See REMOTE_AGENT_SESSIONS.md §5.
 */
import 'server-only';
import { randomUUID } from 'crypto';
import type { AgentInvocation } from '@/orchestrator/types';
import type { ToolResultMessage } from '@/orchestrator/llm';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import { getPageType } from '@/agents/analyst/skills';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { UserDB } from '@/lib/database/user-db';
import type { Mode } from '@/lib/mode/mode-types';
import {
  getConversation,
  getMaxSeq,
  appendMessages,
  loadLog,
  setRunStatus,
} from '@/lib/data/conversations.server';
import type { Conversation } from '@/lib/data/conversations.types';
import {
  buildRemoteSessionRecord,
  decodeRemoteSessionCode,
  encodeRemoteSessionCode,
  markRemoteSessionRevoked,
  remoteSessionDenial,
  saveRemoteSession,
  touchRemoteSession,
} from '@/lib/data/remote-sessions.server';
import type { RemoteSessionDenial, RemoteSessionMintResult, RemoteSessionPage } from '@/lib/data/remote-sessions.types';
import { notifyInterrupt, notifyMessage, notifyStatus } from '@/lib/chat/conversation-stream.server';

/** Root-invocation user message — rendered as the turn boundary in the side chat and in later
 *  turns' projected thread history. */
const SESSION_ROOT_MESSAGE = 'Remote agent session';

export class RemoteSessionMintError extends Error {
  constructor(public readonly reason: 'busy') {
    super('a turn is active on this conversation — stop it before starting a remote session');
    this.name = 'RemoteSessionMintError';
  }
}

/** Build the agent context the session's tools will read (schema, whitelist, context docs, …) —
 *  the same server-resolved pieces `setupOrchestration` gives a browser turn that sends no
 *  client pointers. Stored on the root invocation like any other turn's context. */
async function buildRemoteSessionContext(user: EffectiveUser, appState?: unknown): Promise<RemoteAnalystContext> {
  const serverArgs = await buildServerAgentArgs(user, {});
  const whitelistedTables: string[] = [];
  for (const s of serverArgs.schema) {
    for (const t of s.tables) {
      whitelistedTables.push(t);
      whitelistedTables.push(`${s.schema}.${t}`);
    }
  }
  return {
    userId: String(user.userId ?? user.email),
    mode: user.mode === 'tutorial' ? 'tutorial' : 'org',
    effectiveUser: user,
    connectionId: serverArgs.connection_id,
    whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
    resolvedContextDocs: serverArgs.context_docs,
    annotations: serverArgs.annotations,
    schema: serverArgs.schema,
    homeFolder: resolveHomeFolderSync(user.mode, user.home_folder || ''),
    role: user.role,
    // Mint-time app state (the page the user is looking at) — same field a normal turn carries,
    // so tools and later LLM turns see what was on screen when the session started.
    appState,
    pageType: getPageType(appState),
    // Frozen like Orchestrator.run() does, so later projections re-render identically.
    currentTime: `${new Date().toISOString().slice(0, 13).replace('T', ' ')}:00 UTC`,
  } as RemoteAnalystContext;
}

/** Lean page summary from a file-page app state (undefined for explore/folder/absent states). */
export function summarizeAppStatePage(appState: unknown): RemoteSessionPage | undefined {
  const a = appState as { type?: string; state?: { fileState?: { id?: number; type?: string; name?: string; path?: string } } } | null;
  const fs = a && a.type === 'file' ? a.state?.fileState : undefined;
  if (!fs || typeof fs.id !== 'number') return undefined;
  return {
    fileId: fs.id,
    ...(fs.type ? { fileType: fs.type } : {}),
    ...(fs.name ? { fileName: fs.name } : {}),
    ...(fs.path ? { path: fs.path } : {}),
  };
}

/**
 * Mint (or re-mint) a session for a conversation the caller owns. Mutual exclusion: refused while a
 * turn is `running`/`paused` (RemoteSessionMintError 'busy'); `idle`/`error` enter fresh; already-
 * `remote` re-mints (prior code dies, no second root invocation).
 */
export async function mintRemoteSession(
  conversation: Conversation,
  user: EffectiveUser,
  baseUrl: string,
  opts: { appState?: unknown } = {},
): Promise<RemoteSessionMintResult> {
  if (conversation.runStatus === 'running' || conversation.runStatus === 'paused') {
    throw new RemoteSessionMintError('busy');
  }
  const reMint = conversation.runStatus === 'remote' && !!conversation.meta.remoteSession;
  const { nonce, record } = buildRemoteSessionRecord(user.userId);
  const page = summarizeAppStatePage(opts.appState) ?? conversation.meta.remoteSession?.page;
  if (page) record.page = page;

  if (!reMint) {
    // Session root invocation — gives every remote tool call a valid parent and the tools their
    // context. Appended exactly like Orchestrator.run() appends a turn's root.
    const context = await buildRemoteSessionContext(user, opts.appState);
    const rootInvocation: AgentInvocation & { parent_id: null } = {
      type: 'toolCall',
      id: randomUUID(),
      name: 'RemoteSessionAgent',
      arguments: { userMessage: SESSION_ROOT_MESSAGE },
      context,
      parent_id: null,
    };
    const startSeq = (await getMaxSeq(conversation.id)) + 1;
    await appendMessages(conversation.id, [rootInvocation], startSeq);
    await notifyMessage(conversation.id, startSeq);
  }

  await saveRemoteSession(conversation.id, record);
  await setRunStatus(conversation.id, 'remote');
  await notifyStatus(conversation.id, 'remote', await getMaxSeq(conversation.id));

  const code = encodeRemoteSessionCode(conversation.id, nonce);
  const url = `${baseUrl}/s/${code}`;
  return {
    url,
    code,
    expiresAt: record.expiresAt,
    copyText: `Fetch ${url} and follow its instructions to operate my MinusX session.`,
  };
}

/**
 * End a session (user Stop, agent /end, or lazy expiry release): revoke the code, resolve any
 * still-unanswered remote tool calls with an isError result (the log must never be left with a
 * dangling call — a later normal turn must load cleanly), release to idle, and wake both the
 * browser stream and any in-flight tool-endpoint waiter.
 */
export async function endRemoteSession(conversationId: number): Promise<void> {
  await markRemoteSessionRevoked(conversationId);

  const conversation = await getConversation(conversationId);
  if (conversation?.runStatus === 'remote') {
    const log = await loadLog(conversationId);
    const resolved = new Set<string>();
    const dangling = new Map<string, { name: string; parent_id: string | null }>();
    for (const e of log) {
      if ('role' in e && e.role === 'assistant') {
        for (const c of e.content) {
          if (c.type === 'toolCall') dangling.set(c.id, { name: c.name, parent_id: e.parent_id });
        }
      } else if ('role' in e && e.role === 'toolResult') {
        resolved.add(e.toolCallId);
      }
    }
    const closers: (ToolResultMessage & { parent_id: string | null })[] = [];
    for (const [id, info] of dangling) {
      if (resolved.has(id)) continue;
      closers.push({
        role: 'toolResult',
        toolCallId: id,
        toolName: info.name,
        content: [{ type: 'text', text: 'Remote session ended before this tool call completed.' }],
        isError: true,
        timestamp: Date.now(),
        parent_id: info.parent_id,
      });
    }
    if (closers.length > 0) {
      const startSeq = (await getMaxSeq(conversationId)) + 1;
      await appendMessages(conversationId, closers, startSeq);
      await notifyMessage(conversationId, startSeq + closers.length - 1);
    }
    await setRunStatus(conversationId, 'idle');
    await notifyStatus(conversationId, 'idle', await getMaxSeq(conversationId));
    await notifyInterrupt(conversationId);
  }
}

export type ResolvedRemoteSession =
  | { ok: true; conversation: Conversation; user: EffectiveUser }
  | { ok: false; denial: RemoteSessionDenial | 'malformed' };

/**
 * Resolve a bearer code to a live session: decode → load → verify hash → liveness. An expired /
 * idle-expired session is lazily released here (revoked + conversation → idle) so the freeze lifts
 * without a background reaper. On success, bumps `lastActivityAt` and returns the OWNER's
 * EffectiveUser (positive userId, real role, the conversation's stored mode).
 */
export async function resolveRemoteSession(code: string): Promise<ResolvedRemoteSession> {
  const decoded = decodeRemoteSessionCode(code);
  if (!decoded) return { ok: false, denial: 'malformed' };

  const conversation = await getConversation(decoded.conversationId);
  if (!conversation) return { ok: false, denial: 'not_found' };

  const denial = remoteSessionDenial(conversation.meta.remoteSession, decoded.nonce);
  if (denial) {
    // Lazy release: only for a code that actually proves ownership of the (now dead) session.
    if (denial === 'expired' || denial === 'idle_expired') await endRemoteSession(conversation.id);
    return { ok: false, denial };
  }

  const owner = await UserDB.getById(conversation.ownerUserId);
  if (!owner) return { ok: false, denial: 'not_found' };
  const user: EffectiveUser = {
    userId: owner.id,
    email: owner.email,
    name: owner.name,
    role: owner.role,
    home_folder: owner.home_folder,
    mode: conversation.mode as Mode,
  };
  await touchRemoteSession(conversation.id);
  return { ok: true, conversation, user };
}
