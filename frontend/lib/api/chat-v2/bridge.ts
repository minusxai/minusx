// Bridge between the TS-orchestrator's pending tool calls and the
// browser-side `executeToolCall` registry (lib/api/tool-handlers.ts).
//
// When `/api/chat/v2` returns `pendingToolCalls`, the chatV2 listener
// middleware calls `bridgePendingTools(pending, dispatch, state, database)`.
// Each pending call is invoked against real Redux state (so EditFile etc.
// actually mutate the file), and we collect the resulting ToolResultMessages
// to POST back to `/api/chat/v2` and resume the orchestrator.

import type { ToolResultMessage } from '@mariozechner/pi-ai';
import type { PendingToolCall } from '@/orchestrator/types';
import type { ToolCall, DatabaseWithSchema, ToolMessage } from '@/lib/types';
import type { AppDispatch, RootState } from '@/store/store';
import { executeToolCall } from '@/lib/api/tool-handlers';

/**
 * Convert each pending tool call into a fake `ToolCall`, drive it through
 * `executeToolCall` (which dispatches into Redux), and return pi-ai
 * `ToolResultMessage[]` ready for `Orchestrator.resume()` /
 * `/api/chat/v2 { completedToolCalls }`.
 *
 * Errors in a single tool become an `isError: true` ToolResultMessage so the
 * orchestrator can recover via the LLM seeing the failure — never thrown.
 */
export async function bridgePendingTools(
  pending: PendingToolCall[],
  dispatch: AppDispatch,
  state: RootState,
  database: DatabaseWithSchema,
  signal?: AbortSignal,
): Promise<ToolResultMessage[]> {
  const out: ToolResultMessage[] = [];
  for (const p of pending) {
    const fakeCall: ToolCall = {
      id: p.id,
      type: 'function',
      function: { name: p.name, arguments: p.parameters },
    };
    try {
      const result: ToolMessage = await executeToolCall(
        fakeCall,
        database,
        dispatch,
        signal,
        state,
      );
      out.push(toolMessageToToolResultMessage(p.id, p.name, result, false));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({
        role: 'toolResult',
        toolCallId: p.id,
        toolName: p.name,
        content: [{ type: 'text', text: message }],
        isError: true,
        timestamp: Date.now(),
      });
    }
  }
  return out;
}

function toolMessageToToolResultMessage(
  toolCallId: string,
  toolName: string,
  msg: ToolMessage,
  isError: boolean,
): ToolResultMessage {
  const text =
    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text }],
    isError,
    timestamp: Date.now(),
  };
}
