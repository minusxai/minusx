/**
 * Remote Agent Sessions — the execution engine (REMOTE_AGENT_SESSIONS.md §5).
 *
 * Each remote tool call is stateless: reconstruct a fresh Orchestrator from the durable log,
 * synthesize an assistant message carrying the externally-authored tool call, and drive
 * `Orchestrator.dispatch()` — the same primitive the LLM loop uses. Server tools execute
 * in-process; frontend-bridged tools throw `UserInputException` (the pending row is committed and
 * the browser observer executes it), and the HTTP handler waits on LISTEN/NOTIFY for the result.
 * Every entry appended here is byte-shaped like a normal turn's, so later LLM turns load cleanly.
 */
import 'server-only';
import { randomUUID } from 'crypto';
import { Orchestrator } from '@/orchestrator/orchestrator';
import {
  UserInputException,
  type ConversationLog,
  type MXAgent,
  type RegistrableClass,
} from '@/orchestrator/types';
import { validateParameters } from '@/orchestrator/utils';
import type { AssistantMessage, ToolResultMessage } from '@/orchestrator/llm';
import { REGISTRABLES } from '@/lib/chat/orchestration-core.server';
import { RemoteSessionAgent } from '@/agents/remote-session/remote-session-agent';
import {
  appendMessages,
  loadLog,
  getConversation,
  ConcurrentAppendError,
} from '@/lib/data/conversations.server';
import type { Conversation } from '@/lib/data/conversations.types';
import type { CompletedToolCall } from '@/lib/types/chat';
import type { CompletedToolCallResult } from '@/lib/chat/chat-types';
import { legacyToolResultToPi } from '@/lib/chat-translator';
import { notifyMessage, notifyStatus, subscribe } from '@/lib/chat/conversation-stream.server';
import { serializeRemoteContent } from '@/lib/chat/remote-session-content.server';
import type { RemoteContentBlock, RemoteToolCallRequest } from '@/lib/data/remote-sessions.types';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { immutableSet } from '@/lib/utils/immutable-collections';

/** Tools an external agent may call — RemoteSessionAgent's declared toolset (leaf tools minus
 *  ClarifyFrontend). Checked BEFORE dispatch so agents/unknown names never touch the log. */
const REMOTE_TOOL_NAMES = immutableSet(RemoteSessionAgent.tools.map((t) => t.name));

/** Leaf tools only (dispatching a registered agent name would run a nested LLM loop) + the session
 *  root class so `reconstructAgent` can rebuild dispatch's parent. */
export const REMOTE_REGISTRABLES: RegistrableClass[] = [
  ...REGISTRABLES.filter((r) => (r as unknown as { type?: string }).type !== 'Agent'),
  RemoteSessionAgent,
];

export const REMOTE_TOOL_POLL_AFTER_MS = 1_500;
const DEFAULT_TOOL_WAIT_MS = 50_000; // under typical 60s proxy timeouts
const MAX_TOOL_WAIT_MS = 55_000;
const WAIT_POLL_MS = 1_000;
const DEFAULT_BROWSER_TIMEOUT_MS = 90_000;
const CALL_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export type RemoteToolOutcome =
  | { kind: 'completed'; toolCallId: string; isError: boolean; content: RemoteContentBlock[] }
  // browserMaybeUnreachable: the call has been pending past the browser timeout — either no tab is
  // attached, or a user confirmation (Navigate/PublishAll) is sitting unanswered. Advisory only:
  // a pending human decision must never be force-closed by a poll (browser-verified failure mode).
  | { kind: 'pending'; toolCallId: string; browserMaybeUnreachable?: boolean }
  | { kind: 'invalid'; message: string }
  | { kind: 'busy'; message: string }
  | { kind: 'not_found' };

function clampWaitMs(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, MAX_TOOL_WAIT_MS);
}

function findToolResult(log: ConversationLog, toolCallId: string): ToolResultMessage | null {
  for (const e of log) {
    if ('role' in e && e.role === 'toolResult' && e.toolCallId === toolCallId) return e;
  }
  return null;
}

function findToolCall(log: ConversationLog, toolCallId: string): { name: string; parent_id: string | null; timestamp: number } | null {
  for (const e of log) {
    if (!('role' in e) || e.role !== 'assistant') continue;
    for (const block of e.content) {
      if (block.type === 'toolCall' && block.id === toolCallId) {
        return { name: block.name, parent_id: e.parent_id, timestamp: e.timestamp };
      }
    }
  }
  return null;
}

/** Unresolved tool-call ids across the whole log (single-flight + dangling checks). */
function unresolvedToolCallIds(log: ConversationLog): string[] {
  const results = new Set<string>();
  for (const e of log) {
    if ('role' in e && e.role === 'toolResult') results.add(e.toolCallId);
  }
  const out: string[] = [];
  for (const e of log) {
    if (!('role' in e) || e.role !== 'assistant') continue;
    for (const block of e.content) {
      if (block.type === 'toolCall' && !results.has(block.id)) out.push(block.id);
    }
  }
  return out;
}

/** The session's root invocation (the LAST RemoteSessionAgent root — one per session). */
function findSessionRootId(log: ConversationLog): string | null {
  let rootId: string | null = null;
  for (const e of log) {
    const t = e as { type?: string; parent_id?: string | null; name?: string; id?: string };
    if (t.type === 'toolCall' && t.parent_id === null && t.name === 'RemoteSessionAgent' && t.id) rootId = t.id;
  }
  return rootId;
}

async function completedOutcome(result: ToolResultMessage): Promise<RemoteToolOutcome> {
  return {
    kind: 'completed',
    toolCallId: result.toolCallId,
    isError: result.isError,
    content: await serializeRemoteContent(result.content),
  };
}

/**
 * Wait for `toolCallId`'s toolResult row: subscribe BEFORE checking (no lost-notify window), then
 * re-SELECT on every wakeup AND on a poll interval (NOTIFY is lossy). Resolves null on timeout.
 */
export async function waitForToolResult(
  conversationId: number,
  toolCallId: string,
  timeoutMs: number,
): Promise<ToolResultMessage | null> {
  const check = async () => findToolResult(await loadLog(conversationId), toolCallId);
  const first = await check();
  if (first || timeoutMs <= 0) return first;

  return new Promise<ToolResultMessage | null>((resolve) => {
    let done = false;
    let unsub: (() => Promise<void>) | undefined;
    const finish = (v: ToolResultMessage | null) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      if (unsub) void unsub().catch(() => {});
      resolve(v);
    };
    const tryCheck = () => {
      void check().then((v) => { if (v) finish(v); }).catch(() => {});
    };
    void subscribe(conversationId, (n) => {
      if (n.kind === 'message' || n.kind === 'status' || n.kind === 'interrupt') tryCheck();
    }).then((u) => {
      if (done) { void u().catch(() => {}); return; }
      unsub = u;
      tryCheck(); // the result may have landed between the first check and the subscribe
    }).catch(() => { /* poll still covers us */ });
    const poll = setInterval(tryCheck, WAIT_POLL_MS);
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Execute one externally-authored tool call against a live remote session. See module docs.
 * `opts.waitMs` (also settable via the request body) bounds the long-poll for browser-bridged
 * tools; on timeout the caller returns 202 and the agent polls the result endpoint.
 */
export async function executeRemoteToolCall(
  conversation: Conversation,
  user: { userId: number; email: string },
  request: RemoteToolCallRequest & { waitMs?: unknown },
  opts: { browserTimeoutMs?: number } = {},
): Promise<RemoteToolOutcome> {
  const startedAt = Date.now();
  const log = await loadLog(conversation.id);

  // Idempotent retry: a callId we've already dispatched returns its current state, never a dup row.
  const callId = typeof request.callId === 'string' && CALL_ID_RE.test(request.callId) ? request.callId : undefined;
  if (callId && findToolCall(log, callId)) {
    const existing = findToolResult(log, callId);
    return existing ? completedOutcome(existing) : { kind: 'pending', toolCallId: callId };
  }

  // Single-flight: one remote call at a time (the browser may still be executing the last one).
  // A call stuck past the browser timeout (tab closed, or a confirmation nobody will answer) is
  // closed HERE — at the moment the agent moves on — never by the poll, which must not kill a
  // pending human decision. Closing it unwedges the session; the new call then proceeds.
  const unresolved = unresolvedToolCallIds(log);
  if (unresolved.length > 0) {
    const stale = findToolCall(log, unresolved[0]);
    const browserTimeoutMs = opts.browserTimeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS;
    if (!stale || Date.now() - stale.timestamp < browserTimeoutMs) {
      return { kind: 'busy', message: `tool call ${unresolved[0]} is still in flight — wait for it (poll /result/${unresolved[0]}) before the next call` };
    }
    const closer: ToolResultMessage & { parent_id: string | null } = {
      role: 'toolResult',
      toolCallId: unresolved[0],
      toolName: stale.name,
      content: [{ type: 'text', text: 'Superseded: no browser completed this tool call in time (browser_unreachable or an unanswered confirmation), and the agent moved on.' }],
      isError: true,
      timestamp: Date.now(),
      parent_id: stale.parent_id,
    };
    try {
      await appendMessages(conversation.id, [closer], log.length);
      await notifyMessage(conversation.id, log.length);
      log.push(closer);
    } catch (err) {
      if (err instanceof ConcurrentAppendError) {
        return { kind: 'busy', message: 'another writer advanced this conversation — retry' };
      }
      throw err;
    }
  }

  if (typeof request.tool !== 'string' || !REMOTE_TOOL_NAMES.has(request.tool)) {
    return {
      kind: 'invalid',
      message: `Unknown tool '${String(request.tool)}'. Available tools: ${[...REMOTE_TOOL_NAMES].join(', ')}.`,
    };
  }
  const args = (request.args ?? {}) as Record<string, unknown>;
  const ToolCls = REMOTE_REGISTRABLES.find((r) => r.schema?.name === request.tool)!;
  const validation = validateParameters(ToolCls.schema.parameters, args);
  if (!validation.ok) {
    return { kind: 'invalid', message: `Invalid parameters for '${request.tool}': ${validation.errors.join('; ')}` };
  }

  const rootId = findSessionRootId(log);
  if (!rootId) return { kind: 'invalid', message: 'session root invocation missing — re-mint the session' };

  const orch = new Orchestrator(REMOTE_REGISTRABLES, [...log]);
  const rootAgent = orch.reconstructAgent(rootId) as MXAgent;

  const toolCallId = callId ?? randomUUID();
  const assistantMsg: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'toolCall', id: toolCallId, name: request.tool, arguments: args }],
    // Provider metadata is display/accounting only — nothing dereferences it for control flow.
    api: 'remote-agent' as AssistantMessage['api'],
    provider: 'remote-agent',
    model: 'remote-session',
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: Date.now(),
  };

  const baseLen = orch.log.length;
  let paused = false;
  await orch.dispatch(assistantMsg, rootAgent).catch((err) => {
    if (err instanceof UserInputException) { paused = true; return; }
    throw err;
  });

  const diff = orch.log.slice(baseLen) as ConversationLog;
  try {
    await appendMessages(conversation.id, diff, log.length);
  } catch (err) {
    if (err instanceof ConcurrentAppendError) {
      return { kind: 'busy', message: 'another writer advanced this conversation — retry' };
    }
    throw err;
  }
  await notifyMessage(conversation.id, log.length + diff.length - 1);

  const result = paused ? null : findToolResult(diff, toolCallId);
  appEventRegistry.publish(AppEvents.REMOTE_TOOL_CALL, {
    mode: conversation.mode,
    conversationId: conversation.id,
    tool: request.tool,
    durationMs: Date.now() - startedAt,
    isError: result?.isError ?? false,
    pending: paused,
    userId: user.userId,
    userEmail: user.email,
  });

  if (!paused) {
    // Server tool — the result is already in the diff.
    return completedOutcome(result!);
  }

  // Frontend-bridged: nudge the browser observer (status notify re-derives pending), then wait.
  await notifyStatus(conversation.id, 'remote', log.length + diff.length - 1);
  const waited = await waitForToolResult(
    conversation.id,
    toolCallId,
    clampWaitMs(request.waitMs, DEFAULT_TOOL_WAIT_MS),
  );
  return waited ? completedOutcome(waited) : { kind: 'pending', toolCallId };
}

/**
 * Result lookup / long-poll for a previously-dispatched call. NEVER force-closes a pending call —
 * a bridged tool may legitimately sit for minutes awaiting a user confirmation (Navigate's Allow).
 * Past the browser timeout the pending response carries `browserMaybeUnreachable: true` so the
 * agent can tell its user to open the app; the stale call is actually closed only when the agent
 * issues its NEXT tool call (see executeRemoteToolCall) or the session ends.
 */
export async function getRemoteToolResult(
  conversation: Conversation,
  toolCallId: string,
  opts: { waitMs?: unknown; browserTimeoutMs?: number } = {},
): Promise<RemoteToolOutcome> {
  const log = await loadLog(conversation.id);
  const call = findToolCall(log, toolCallId);
  if (!call) return { kind: 'not_found' };

  const existing = findToolResult(log, toolCallId);
  if (existing) return completedOutcome(existing);

  const waited = await waitForToolResult(conversation.id, toolCallId, clampWaitMs(opts.waitMs, 25_000));
  if (waited) return completedOutcome(waited);
  const browserTimeoutMs = opts.browserTimeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS;
  return {
    kind: 'pending',
    toolCallId,
    ...(Date.now() - call.timestamp >= browserTimeoutMs ? { browserMaybeUnreachable: true } : {}),
  };
}

/**
 * Turns-route short-circuit (§5.3): while a session holds the conversation, a browser
 * `completedToolCalls` POST is APPEND-ONLY — map to pi toolResults, thread to the owning assistant
 * entry, dedupe already-resolved ids (multi-tab / retries), notify. The orchestrator/LLM never runs.
 */
export async function appendRemoteToolCompletions(
  conversationId: number,
  completedToolCalls: CompletedToolCall[],
): Promise<{ appended: number; deduped: number }> {
  const log = await loadLog(conversationId);
  const entries: ConversationLog = [];
  let deduped = 0;

  for (const tuple of completedToolCalls) {
    const toolCall = tuple[0];
    const result = tuple[1] as unknown as CompletedToolCallResult;
    if (!toolCall?.id) { deduped++; continue; }
    if (findToolResult(log, toolCall.id) || entries.some((e) => 'role' in e && e.role === 'toolResult' && e.toolCallId === toolCall.id)) {
      deduped++;
      continue;
    }
    const call = findToolCall(log, toolCall.id);
    if (!call) { deduped++; continue; } // completion for a call this log never made — drop
    const patched: CompletedToolCallResult = {
      ...result,
      run_id: (result as { run_id?: string }).run_id ?? '',
      function: toolCall.function,
    };
    entries.push({ ...legacyToolResultToPi(patched), parent_id: call.parent_id });
  }

  if (entries.length > 0) {
    await appendMessages(conversationId, entries, log.length);
    await notifyMessage(conversationId, log.length + entries.length - 1);
  }
  return { appended: entries.length, deduped };
}

/** Fresh-read guard used by routes that may race a Stop: is the conversation still remote? */
export async function isStillRemote(conversationId: number): Promise<boolean> {
  return (await getConversation(conversationId))?.runStatus === 'remote';
}
