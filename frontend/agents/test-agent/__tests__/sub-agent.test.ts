import { fauxAssistantMessage, fauxToolCall, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, ConversationLogEntry } from '@/orchestrator/types';
import { EchoTool, PendingTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('sub-agent dispatch (agent-as-tool)', () => {
  it('TestAgent dispatches NestedAgent; nested stop becomes a ToolResultMessage in root\'s thread', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'nested input' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Nested done.', { stopReason: 'stop' }),
      fauxAssistantMessage('All done at root.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'root input' }, ctx);

    const stream = orch.run(root);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.role).toBe('assistant');
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('All done at root.');

    const log: ConversationLogEntry[] = orch.log;

    const nestedToolCall = log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content : []))
      .find((c) => c.type === 'toolCall' && c.name === 'NestedAgent');
    expect(nestedToolCall).toBeDefined();
    const nestedAgentId = (nestedToolCall as { id: string }).id;

    const nestedAssistantEntries = log.filter(
      (e) => 'role' in e && e.role === 'assistant' && e.parent_id === nestedAgentId,
    );
    expect(nestedAssistantEntries).toHaveLength(0);

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
