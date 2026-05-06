import 'server-only';
import type { ToolResultMessage } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type {
  ConversationLog,
  ConversationLogEntry,
  PendingToolCall,
  RegistrableClass,
} from '@/orchestrator/types';
import { WebAnalystAgent, EditFile, CreateFile, DeleteFile } from '@/agents/web-analyst/web-analyst';
import { ReadFiles, SearchFiles } from '@/agents/analyst/file-tools';
import { ListDBConnections, SearchDBSchema, ExecuteSQL } from '@/agents/benchmark-analyst/db-tools';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import {
  appendChatLog,
  createDraftChat,
  loadChatLog,
  type ChatContent,
} from '@/lib/chat-v2/chat-file';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

export const CHAT_V2_REGISTRABLES: RegistrableClass[] = [
  ListDBConnections,
  SearchDBSchema,
  ExecuteSQL,
  ReadFiles,
  SearchFiles,
  EditFile,
  CreateFile,
  DeleteFile,
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
 * Run a single chat turn — either a new user message or a resume with
 * completed tool results. Loads the chat's saved log, runs/resumes the
 * orchestrator, persists the diff (with atomic-or-fork semantics), and
 * returns the new state.
 */
export async function runChatTurn(
  body: ChatV2RequestBody,
  user: EffectiveUser,
): Promise<ChatV2Response> {
  const agentName = 'WebAnalystAgent';
  const agentArgs = body.agentArgs ?? {};

  // Step 1: Resolve the chat (create on first call).
  let chatId = body.chatId;
  if (chatId == null) {
    const created = await createDraftChat(user, agentName, agentArgs);
    chatId = created.chatId;
  }

  // Step 2: Load the saved log.
  const chat: ChatContent = await loadChatLog(chatId, user);
  const savedLog: ConversationLog = chat.log;
  const expectedLogIndex = savedLog.length;

  // Step 3: Build agent context.
  // EffectiveUser.mode is a broader Mode union (includes 'internals' etc.)
  // RemoteAnalystContext narrows it to 'org' | 'tutorial' since the analyst
  // hierarchy doesn't operate in internals. Treat anything else as 'org'.
  const narrowedMode: 'org' | 'tutorial' = user.mode === 'tutorial' ? 'tutorial' : 'org';
  const ctx: RemoteAnalystContext = {
    userId: String(user.userId ?? user.email),
    mode: narrowedMode,
    effectiveUser: user,
  };

  // Step 4: Construct orchestrator with saved-log copy. Run or resume.
  const orch = new Orchestrator(CHAT_V2_REGISTRABLES, [...savedLog]);
  let runError: string | undefined;
  let stream: ReturnType<Orchestrator['run']>;

  if (body.message != null) {
    const agent = new WebAnalystAgent(orch, { userMessage: body.message }, ctx);
    stream = orch.run(agent);
  } else if (body.completedToolCalls && body.completedToolCalls.length > 0) {
    stream = orch.resume(body.completedToolCalls);
  } else {
    return {
      chatId,
      forked: false,
      log: savedLog,
      pendingToolCalls: [],
      done: 'error',
      error: 'runChatTurn: must supply either `message` or `completedToolCalls`',
    };
  }

  try {
    for await (const _ev of stream) {
      // Drain — events are accumulated in orch.log; the SSE wrapper consumes
      // these directly, but the non-streaming endpoint just snapshots the
      // final log.
    }
    await stream.result();
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  }

  // Step 5: Persist log diff.
  const fullLog = orch.log;
  const logDiff: ConversationLogEntry[] = fullLog.slice(expectedLogIndex);
  let finalChatId = chatId;
  let forked = false;
  if (logDiff.length > 0) {
    const appendResult = await appendChatLog(chatId, logDiff, expectedLogIndex, user);
    finalChatId = appendResult.chatId;
    forked = appendResult.forked;
  }

  // Step 6: Compute response shape.
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
