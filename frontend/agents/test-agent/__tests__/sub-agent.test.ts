import { fauxAssistantMessage, fauxToolCall, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, ConversationLogEntry } from '@/orchestrator/types';
import { EchoTool, PendingTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('sub-agent dispatch (agent-as-tool)', () => {
  it('TestAgent dispatches NestedAgent; nested stop becomes a ToolResultMessage in root\'s thread', async () => {
    fauxRegistration.setResponses([
      // TestAgent turn 1: invoke NestedAgent.
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'nested input' })],
        { stopReason: 'toolUse' },
      ),
      // NestedAgent turn 1: stop with text.
      fauxAssistantMessage('Nested done.', { stopReason: 'stop' }),
      // TestAgent turn 2: stop with text.
      fauxAssistantMessage('All done at root.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'root input' }, ctx);

    const stream = orch.run(root);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    // Final result is the root's stop AssistantMessage.
    expect(result).not.toBeNull();
    expect(result!.role).toBe('assistant');
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('All done at root.');

    // Inspect log shape:
    // [0] AgentInvocation (root, parent_id=null)
    // [1] AssistantMessage (root turn 1, contains NestedAgent ToolCall)
    // [2] (no AssistantMessage entry for NestedAgent's stop — that's the point)
    // [2] ToolResultMessage (NestedAgent's wrapped result, parent_id=root.id)
    // [3] AssistantMessage (root turn 2, stop, parent_id=root.id)
    const log: ConversationLogEntry[] = orch.log;

    // No AssistantMessage with parent_id pointing to NestedAgent's id.
    const nestedToolCall = log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content : []))
      .find((c) => c.type === 'toolCall' && c.name === 'NestedAgent');
    expect(nestedToolCall).toBeDefined();
    const nestedAgentId = (nestedToolCall as { id: string }).id;

    const nestedAssistantEntries = log.filter(
      (e) => 'role' in e && e.role === 'assistant' && e.parent_id === nestedAgentId,
    );
    expect(nestedAssistantEntries).toHaveLength(0);

    // Confirm the wrapped ToolResultMessage IS in the log under root's parent_id.
    const wrappedResult = log.find(
      (e) =>
        'role' in e &&
        e.role === 'toolResult' &&
        e.toolCallId === nestedAgentId &&
        e.toolName === 'NestedAgent',
    );
    expect(wrappedResult).toBeDefined();
    expect(wrappedResult!.parent_id).toBe(root.id);
    expect(((wrappedResult as { content: TextContent[] }).content[0]).text).toContain('Nested done.');

    // Root's stop AssistantMessage IS in the log.
    const rootStop = log.find(
      (e) =>
        'role' in e &&
        e.role === 'assistant' &&
        e.parent_id === root.id &&
        e.stopReason === 'stop',
    );
    expect(rootStop).toBeDefined();
  });
});
