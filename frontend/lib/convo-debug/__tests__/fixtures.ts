/** Shared fixture builders for convo-debug tests. */
import type { AssistantMessage, Message, ToolResultMessage, Usage, UserMessage } from '@/orchestrator/llm';
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';
import type { ConvoDebugInput, ModelRates } from '@/lib/convo-debug/types';

export const MODEL = 'claude-test';

export function usage(over: Partial<Usage> = {}, cost: Partial<Usage['cost']> = {}): Usage {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, ...cost },
    ...over,
  };
}

export function user(text: string, timestamp = 1): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp };
}

export function assistant(
  content: AssistantMessage['content'],
  over: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages' as never,
    provider: 'anthropic',
    model: MODEL,
    usage: usage(),
    stopReason: 'stop',
    timestamp: 2,
    ...over,
  };
}

export function toolResult(toolCallId: string, toolName: string, text: string, timestamp = 3): ToolResultMessage {
  return { role: 'toolResult', toolCallId, toolName, content: [{ type: 'text', text }], isError: false, timestamp };
}

export function rootInvocation(id: string, name = 'AnalystAgent'): ConversationLogEntry {
  return { type: 'toolCall', id, name, arguments: {}, context: {}, parent_id: null };
}

export function logEntry(msg: AssistantMessage | ToolResultMessage, parentId: string): ConversationLogEntry {
  return { ...msg, parent_id: parentId };
}

export function subInvocation(id: string, name: string, parentId: string): ConversationLogEntry {
  return { type: 'toolCall', id, name, arguments: {}, context: {}, parent_id: parentId };
}

export const RATES: ModelRates = {
  // $/token: input $3/Mtok, output $15/Mtok, cacheRead $0.3/Mtok, cacheWrite $3.75/Mtok
  [MODEL]: { input: 3e-6, output: 15e-6, cacheRead: 0.3e-6, cacheWrite: 3.75e-6 },
};

export function makeInput(over: Partial<ConvoDebugInput> = {}): ConvoDebugInput {
  return {
    systemPrompt: '',
    toolDefsChars: 0,
    messages: [] as Message[],
    log: [] as ConversationLog,
    rates: RATES,
    ...over,
  };
}
