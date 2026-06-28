/**
 * streamed-tool-calls — converts committed pi-log entries arriving mid-stream into the
 * `CompletedToolCall` shape the chat UI renders live (via `streamedCompletedToolCalls`). This is
 * what makes SERVER tool calls (ExecuteQuery / SearchDBSchema / SearchFiles) appear AS THEY RUN
 * during a v3 turn instead of popping in only after the turn settles.
 */
import { collectToolCallMeta, piToolResultToStreamedCall } from '@/lib/chat/streamed-tool-calls';

const assistant = {
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'hmm' },
    { type: 'toolCall', id: 'tc1', name: 'ExecuteQuery', arguments: { query: 'select 1' } },
  ],
} as unknown;

const toolResult = {
  role: 'toolResult',
  toolCallId: 'tc1',
  toolName: 'ExecuteQuery',
  content: [{ type: 'text', text: 'ok' }],
  details: { success: true, queryResult: { columns: ['a'], types: ['number'], rows: [[1]] } },
  isError: false,
  timestamp: 1000,
} as unknown;

const rootInvocation = { type: 'toolCall', id: 'r', name: 'WebAnalystAgent', parent_id: null } as unknown;

describe('streamed-tool-calls', () => {
  it('collectToolCallMeta extracts id→{name,arguments} from assistant toolCall blocks', () => {
    const m = collectToolCallMeta(assistant);
    expect(m.get('tc1')).toEqual({ name: 'ExecuteQuery', arguments: { query: 'select 1' } });
  });

  it('collectToolCallMeta returns empty for non-assistant content', () => {
    expect(collectToolCallMeta(toolResult).size).toBe(0);
    expect(collectToolCallMeta(rootInvocation).size).toBe(0);
  });

  it('piToolResultToStreamedCall builds a CompletedToolCall with paired args + passed-through details', () => {
    const meta = collectToolCallMeta(assistant).get('tc1');
    const call = piToolResultToStreamedCall(toolResult, meta);
    expect(call).toBeTruthy();
    expect(call!.role).toBe('tool');
    expect(call!.tool_call_id).toBe('tc1');
    expect(call!.function.name).toBe('ExecuteQuery');
    expect(JSON.parse(call!.function.arguments)).toEqual({ query: 'select 1' });
    // details (incl. queryResult that the display needs) must survive
    expect(call!.details?.queryResult.rows).toEqual([[1]]);
    expect(call!.details?.success).toBe(true);
    expect(call!.content).toBe('ok');
  });

  it('returns null for assistant messages and the root user invocation (not tool results)', () => {
    expect(piToolResultToStreamedCall(assistant, undefined)).toBeNull();
    expect(piToolResultToStreamedCall(rootInvocation, undefined)).toBeNull();
  });

  it('falls back to toolName when meta is missing, and skips TalkToUser results', () => {
    const call = piToolResultToStreamedCall(toolResult, undefined);
    expect(call!.function.name).toBe('ExecuteQuery');
    expect(call!.function.arguments).toBe('{}');
    const ttu = piToolResultToStreamedCall(
      { role: 'toolResult', toolCallId: 'x', toolName: 'TalkToUser', content: [], isError: false } as unknown,
      undefined,
    );
    expect(ttu).toBeNull();
  });
});
