import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type {
  AssistantMessage,
  ToolResultMessage,
  Usage,
} from '@mariozechner/pi-ai';
import type { ConversationLogEntry, Task, TaskResult } from './conversation';

const ROOT_USER_MESSAGE_KEY = '_user_message';

const PLACEHOLDER_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function placeholderAssistant(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'openai',
    model: 'logged',
    usage: PLACEHOLDER_USAGE,
    stopReason,
    timestamp: 0,
  };
}

/** Stash the user message inside the root Task args so it can be reconstructed later. */
export function userMessageArgs(userMessage: string | null): Record<string, unknown> {
  return userMessage ? { [ROOT_USER_MESSAGE_KEY]: userMessage } : {};
}

export function readUserMessage(args: Record<string, unknown>): string | null {
  const v = args[ROOT_USER_MESSAGE_KEY];
  return typeof v === 'string' ? v : null;
}

/**
 * Reconstruct LLM-compatible messages from a Task/TaskResult log.
 *
 * For each root task (representing one full agent run / conversation turn):
 *   - emit the user message stashed in the root task's args
 *   - emit one AssistantMessage + ToolResultMessage batch per group of child tasks
 *     sharing the same _run_id (each batch = one LLM tool-use turn within the run)
 *   - emit the final assistant text reply from the root TaskResult
 */
export function buildMessagesFromLog(log: ConversationLogEntry[]): AgentMessage[] {
  const messages: AgentMessage[] = [];

  const rootTasks: Task[] = log.filter(
    (e): e is Task => e._type === 'task' && e._parent_unique_id === null,
  );

  // Index TaskResults by task unique_id for O(1) lookup.
  const resultByTaskId = new Map<string, unknown>();
  for (const e of log) {
    if (e._type === 'task_result') {
      resultByTaskId.set((e as TaskResult)._task_unique_id, (e as TaskResult).result);
    }
  }

  for (const rootTask of rootTasks) {
    // 1. User message
    const userText = readUserMessage(rootTask.args);
    if (userText) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: userText }],
        timestamp: 0,
      });
    }

    // 2. Child tasks for this root, in log order, grouped by _run_id (= one LLM tool-use turn)
    const childTasks: Task[] = log.filter(
      (e): e is Task => e._type === 'task' && e._parent_unique_id === rootTask.unique_id,
    );

    const batches = new Map<string, Task[]>();
    for (const child of childTasks) {
      const batch = batches.get(child._run_id);
      if (batch) {
        batch.push(child);
      } else {
        batches.set(child._run_id, [child]);
      }
    }

    for (const batchTasks of batches.values()) {
      const toolCalls = batchTasks.map((t) => ({
        type: 'toolCall' as const,
        id: t.unique_id,
        name: t.agent,
        arguments: t.args,
      }));

      messages.push(placeholderAssistant(toolCalls, 'toolUse'));

      for (const t of batchTasks) {
        const result = resultByTaskId.get(t.unique_id);
        const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
        const toolResult: ToolResultMessage = {
          role: 'toolResult',
          toolCallId: t.unique_id,
          toolName: t.agent,
          content: [{ type: 'text', text }],
          isError: false,
          timestamp: 0,
        };
        messages.push(toolResult);
      }
    }

    // 3. Final assistant text reply (from root TaskResult)
    const rootResult = resultByTaskId.get(rootTask.unique_id);
    if (typeof rootResult === 'string' && rootResult.length > 0 && rootResult !== 'done') {
      messages.push(placeholderAssistant([{ type: 'text', text: rootResult }], 'stop'));
    }
  }

  return messages;
}
