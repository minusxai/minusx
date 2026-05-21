import type { TextContent, ToolCall } from '@/orchestrator/llm';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, ConversationLogEntry } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('3-level deep nesting (TestAgent → NestedAgent → DeepAgent → stop)', () => {
  it('bubbles wrapped ToolResultMessages up two layers, only the root\'s stop AssistantMessage lives in the log', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'middle' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        [fauxToolCall('DeepAgent', { userMessage: 'deep' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Deep done.', { stopReason: 'stop' }),
      fauxAssistantMessage('Nested done.', { stopReason: 'stop' }),
      fauxAssistantMessage('Root done.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'root' }, ctx);

    const stream = orch.run(root);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.role).toBe('assistant');
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('Root done.');

    const log: ConversationLogEntry[] = orch.log;

    const nestedToolCall = log
      .flatMap((e) => ('role' in e && e.role === 'assistant' && e.parent_id === root.id ? e.content : []))
      .find((c): c is ToolCall => c.type === 'toolCall' && c.name === 'NestedAgent');
    expect(nestedToolCall).toBeDefined();
    const nestedAgentId = nestedToolCall!.id;

    const deepToolCall = log
      .flatMap((e) => ('role' in e && e.role === 'assistant' && e.parent_id === nestedAgentId ? e.content : []))
      .find((c): c is ToolCall => c.type === 'toolCall' && c.name === 'DeepAgent');
    expect(deepToolCall).toBeDefined();
    const deepAgentId = deepToolCall!.id;

    const deepStopAssistants = log.filter(
      (e) => 'role' in e && e.role === 'assistant' && e.parent_id === deepAgentId && e.stopReason === 'stop',
    );
    expect(deepStopAssistants).toHaveLength(0);

    const nestedStopAssistants = log.filter(
      (e) => 'role' in e && e.role === 'assistant' && e.parent_id === nestedAgentId && e.stopReason === 'stop',
    );
    expect(nestedStopAssistants).toHaveLength(0);

    const deepWrap = log.find(
      (e): e is typeof e & { role: 'toolResult'; toolCallId: string; content: TextContent[] } =>
        'role' in e && e.role === 'toolResult' && e.toolCallId === deepAgentId,
    );
    expect(deepWrap).toBeDefined();
    expect(deepWrap!.parent_id).toBe(nestedAgentId);
    expect(deepWrap!.content[0].text).toContain('Deep done.');

    const nestedWrap = log.find(
      (e): e is typeof e & { role: 'toolResult'; toolCallId: string; content: TextContent[] } =>
        'role' in e && e.role === 'toolResult' && e.toolCallId === nestedAgentId,
    );
    expect(nestedWrap).toBeDefined();
    expect(nestedWrap!.parent_id).toBe(root.id);
    expect(nestedWrap!.content[0].text).toContain('Nested done.');

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
