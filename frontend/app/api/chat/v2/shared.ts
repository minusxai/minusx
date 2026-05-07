import 'server-only';
import type { ToolResultMessage } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type {
  ConversationLog,
  ConversationLogEntry,
  PendingToolCall,
  RegistrableClass,
  StreamEvent,
} from '@/orchestrator/types';
import { WebAnalystAgent, EditFile, CreateFile } from '@/agents/web-analyst/web-analyst';
import { ReadFiles, SearchFiles } from '@/agents/analyst/file-tools';
import { ListDBConnections, SearchDBSchema, ExecuteSQL } from '@/agents/benchmark-analyst/db-tools';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import {
  appendChatLog,
  createDraftChat,
  loadChatLog,
  type ChatContent,
} from '@/lib/chat-v2/chat-file';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

export const CHAT_V2_REGISTRABLES: RegistrableClass[] = [
  ListDBConnections,
  SearchDBSchema,
  ExecuteSQL,
  ReadFiles,
  SearchFiles,
  EditFile,
  CreateFile,
  WebAnalystAgent,
];

export interface ChatV2RequestBody {
  chatId?: number;
  message?: string;
  completedToolCalls?: ToolResultMessage[];
  agentArgs?: Record<string, unknown>;
}

export interface ChatV2Response {
  chatId: number;
  forked: boolean;
  log: ConversationLog;
  pendingToolCalls: PendingToolCall[];
  done: 'stop' | 'pending' | 'error';
  error?: string;
}

/**
 * SSE event yielded by `runChatTurnStream`. Mirrors a subset of the
 * orchestrator's internal `StreamEvent` plus a `done` envelope carrying the
 * full final-state payload (same shape as the non-streaming response).
 */
export type ChatV2StreamEvent =
  | { type: 'orchestrator'; event: StreamEvent }
  | { type: 'done'; response: ChatV2Response };

interface OrchestrationSetup {
  chatId: number;
  expectedLogIndex: number;
  orchestrator: Orchestrator;
  rawStream: ReturnType<Orchestrator['run']> | null;
  fatalError?: string;
}

async function setupOrchestration(
  body: ChatV2RequestBody,
  user: EffectiveUser,
): Promise<OrchestrationSetup> {
  // The agent class for new turns comes from the request (or defaults).
  // Per the new chat-file shape, agent identity is NOT stored on the chat
  // file — each root AgentInvocation log entry already carries `name`, so a
  // chat could in principle host multiple agent types across turns.
  const agentArgs = body.agentArgs ?? {};

  let chatId = body.chatId;
  if (chatId == null) {
    const created = await createDraftChat(user);
    chatId = created.chatId;
  }

  const chat: ChatContent = await loadChatLog(chatId, user);
  const savedLog: ConversationLog = chat.log;
  const expectedLogIndex = savedLog.length;

  // EffectiveUser.mode is a broader Mode union (includes 'internals' etc.)
  // RemoteAnalystContext narrows to 'org' | 'tutorial' — anything else
  // collapses to 'org'.
  const narrowedMode: 'org' | 'tutorial' = user.mode === 'tutorial' ? 'tutorial' : 'org';

  // Reuse the shared server agent-args builder (same code path Slack /
  // reports / evals use) to derive whitelisted schema + documentation. When
  // `agentArgs.contextFileId` is set, that specific context drives the run;
  // otherwise the user's nearest ancestor context is used.
  const contextFileId =
    typeof agentArgs.contextFileId === 'number' ? agentArgs.contextFileId : undefined;
  const serverArgs = await buildServerAgentArgs(
    user,
    contextFileId != null ? { contextFileId } : undefined,
  );
  const whitelistedTables: string[] = [];
  for (const s of serverArgs.schema) {
    for (const t of s.tables) {
      whitelistedTables.push(t);
      whitelistedTables.push(`${s.schema}.${t}`);
    }
  }
  const ctx: RemoteAnalystContext = {
    userId: String(user.userId ?? user.email),
    mode: narrowedMode,
    effectiveUser: user,
    connectionId: serverArgs.connection_id,
    whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
    contextDocs: serverArgs.context || undefined,
  };

  const orch = new Orchestrator(CHAT_V2_REGISTRABLES, [...savedLog]);

  if (body.message != null) {
    const agent = new WebAnalystAgent(orch, { userMessage: body.message }, ctx);
    return { chatId, expectedLogIndex, orchestrator: orch, rawStream: orch.run(agent) };
  }
  if (body.completedToolCalls && body.completedToolCalls.length > 0) {
    return {
      chatId,
      expectedLogIndex,
      orchestrator: orch,
      rawStream: orch.resume(body.completedToolCalls),
    };
  }
  return {
    chatId,
    expectedLogIndex,
    orchestrator: orch,
    rawStream: null,
    fatalError: 'runChatTurn: must supply either `message` or `completedToolCalls`',
  };
}

async function persistAndBuildResponse(
  chatId: number,
  expectedLogIndex: number,
  orch: Orchestrator,
  user: EffectiveUser,
  runError: string | undefined,
): Promise<ChatV2Response> {
  const fullLog = orch.log;
  const logDiff: ConversationLogEntry[] = fullLog.slice(expectedLogIndex);
  let finalChatId = chatId;
  let forked = false;
  if (logDiff.length > 0) {
    const appendResult = await appendChatLog(chatId, logDiff, expectedLogIndex, user);
    finalChatId = appendResult.chatId;
    forked = appendResult.forked;
  }
  const pendingToolCalls = orch.getPendingToolCalls();
  const done: 'stop' | 'pending' | 'error' = runError
    ? 'error'
    : pendingToolCalls.length > 0
      ? 'pending'
      : 'stop';
  return {
    chatId: finalChatId,
    forked,
    log: fullLog,
    pendingToolCalls,
    done,
    error: runError,
  };
}

/**
 * Drain-and-snapshot variant. Used by the non-streaming /api/chat/v2 route
 * + most tests.
 */
export async function runChatTurn(
  body: ChatV2RequestBody,
  user: EffectiveUser,
): Promise<ChatV2Response> {
  const setup = await setupOrchestration(body, user);
  if (setup.fatalError) {
    return {
      chatId: setup.chatId,
      forked: false,
      log: setup.orchestrator.log,
      pendingToolCalls: [],
      done: 'error',
      error: setup.fatalError,
    };
  }
  let runError: string | undefined;
  try {
    if (setup.rawStream) {
      for await (const _ev of setup.rawStream) { /* drain */ }
      await setup.rawStream.result();
    }
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  }
  return persistAndBuildResponse(
    setup.chatId,
    setup.expectedLogIndex,
    setup.orchestrator,
    user,
    runError,
  );
}

/**
 * Streaming variant: yields each orchestrator stream event as it arrives,
 * then a final `done` event carrying the same payload as `runChatTurn`.
 * The SSE route (/api/chat/v2/stream) wraps this; the client-side listener
 * parses the SSE frames into Redux updates.
 */
export async function* runChatTurnStream(
  body: ChatV2RequestBody,
  user: EffectiveUser,
): AsyncGenerator<ChatV2StreamEvent, void, unknown> {
  const setup = await setupOrchestration(body, user);
  if (setup.fatalError) {
    yield {
      type: 'done',
      response: {
        chatId: setup.chatId,
        forked: false,
        log: setup.orchestrator.log,
        pendingToolCalls: [],
        done: 'error',
        error: setup.fatalError,
      },
    };
    return;
  }
  let runError: string | undefined;
  try {
    if (setup.rawStream) {
      for await (const ev of setup.rawStream) {
        yield { type: 'orchestrator', event: ev };
      }
      await setup.rawStream.result();
    }
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  }
  const response = await persistAndBuildResponse(
    setup.chatId,
    setup.expectedLogIndex,
    setup.orchestrator,
    user,
    runError,
  );
  yield { type: 'done', response };
}
