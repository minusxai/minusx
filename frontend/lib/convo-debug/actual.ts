/**
 * Recorded-call extraction + "Raw" data-source parsing for the /debug viz.
 *
 * `extractActualCalls` walks the verbatim conversation log and returns every
 * LLM call (assistant entry) in log order, flagging sub-agent calls (parent
 * chain not reaching a root invocation directly) and resolving the root-level
 * tool they ran under. Root calls, in order, align 1:1 with bar `callIndex`.
 *
 * `requestJsonToInput` parses one recorded `llm_logs.request_json` blob (the
 * exact pi-format `Context` sent to the provider) into a `ConvoDebugInput` —
 * the ground truth for the "Raw" logs toggle.
 */
import type { AssistantMessage, Message, Tool } from '@/orchestrator/llm';
import type { AgentInvocation, ConversationLog, ConversationLogEntry } from '@/orchestrator/types';
import type { ActualCallRecord, ConvoDebugInput, ModelRates } from './types';

function isAssistantEntry(entry: ConversationLogEntry): entry is AssistantMessage & { parent_id: string | null } {
  return 'role' in entry && entry.role === 'assistant';
}

function isInvocationEntry(entry: ConversationLogEntry): entry is AgentInvocation & { parent_id: string | null } {
  return 'type' in entry && entry.type === 'toolCall';
}

/** The engine stamps `_lllmCallId` on the message, or on its first toolCall block. */
export function callIdOf(msg: AssistantMessage): string | null {
  const own = (msg as unknown as Record<string, unknown>)['_lllmCallId'];
  if (typeof own === 'string') return own;
  for (const block of msg.content) {
    if (block.type !== 'toolCall') continue;
    const stamped = (block as unknown as Record<string, unknown>)['_lllmCallId'];
    if (typeof stamped === 'string') return stamped;
  }
  return null;
}

export function extractActualCalls(log: ConversationLog): ActualCallRecord[] {
  const rootIds = new Set(log.filter((e) => isInvocationEntry(e) && e.parent_id === null).map((e) => (e as { id: string }).id));
  const byId = new Map<string, ConversationLogEntry>();
  for (const entry of log) {
    if (isInvocationEntry(entry)) byId.set(entry.id, entry);
  }

  /** Walk the invocation chain up to the invocation directly under a root. */
  function rootLevelInvocation(parentId: string | null): (AgentInvocation & { parent_id: string | null }) | null {
    let current = parentId != null ? byId.get(parentId) : undefined;
    while (current && isInvocationEntry(current)) {
      if (current.parent_id !== null && rootIds.has(current.parent_id)) return current;
      current = current.parent_id != null ? byId.get(current.parent_id) : undefined;
    }
    return null;
  }

  const calls: ActualCallRecord[] = [];
  for (const entry of log) {
    if (!isAssistantEntry(entry)) continue;
    const isRoot = entry.parent_id !== null && rootIds.has(entry.parent_id);
    const owner = isRoot ? null : rootLevelInvocation(entry.parent_id);
    calls.push({
      callId: callIdOf(entry),
      model: entry.model,
      usage: entry.usage,
      isSubAgent: !isRoot,
      ...(owner ? { rootToolName: owner.name, rootToolCallId: owner.id } : {}),
    });
  }
  return calls;
}

/**
 * Parse a recorded pi-format request blob into the normalized debug input.
 * A request contains only what was SENT to the provider — never its own
 * response — so when `responseCallId` is given, the log's assistant entry
 * stamped with that call id (the response to this exact request) is appended,
 * making the Raw view show the final assistant turn too.
 */
export function requestJsonToInput(
  requestJson: string,
  log: ConversationLog,
  rates: ModelRates,
  responseCallId?: string | null,
): ConvoDebugInput {
  const parsed = JSON.parse(requestJson) as {
    systemPrompt?: string;
    messages?: Message[];
    tools?: Tool[];
  };
  if (!parsed || typeof parsed !== 'object' || (parsed.messages !== undefined && !Array.isArray(parsed.messages))) {
    throw new Error('Malformed LLM request json');
  }
  const messages = [...(parsed.messages ?? [])];
  if (responseCallId) {
    const response = log.find(
      (e): e is AssistantMessage & { parent_id: string | null } =>
        isAssistantEntry(e) && callIdOf(e) === responseCallId,
    );
    if (response) {
      const { parent_id: _omit, ...msg } = response;
      messages.push(msg as Message);
    }
  }
  const tools = parsed.tools ?? [];
  return {
    systemPrompt: parsed.systemPrompt ?? '',
    toolDefsChars: tools.length > 0 ? JSON.stringify(tools).length : 0,
    messages,
    log,
    rates,
  };
}
