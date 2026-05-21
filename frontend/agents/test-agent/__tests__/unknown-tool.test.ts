import type { TextContent } from '@/orchestrator/llm';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import {
  EchoTool,
  NestedAgent,
  PendingTool,
  TestAgent,
  fauxRegistration,
} from '../test-agent';

const ctx: AgentContext = { userId: 'u', mode: 'org' };

describe('unknown tool handling', () => {
  it('returns an error ToolResultMessage for a hallucinated tool, then reaches stop', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('NotARealTool', { x: 1 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('I will stop now.', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator([EchoTool, PendingTool, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('I will stop now.');

    const toolResult = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'NotARealTool',
    ) as { isError: boolean; content: TextContent[] } | undefined;
    expect(toolResult).toBeDefined();
    expect(toolResult!.isError).toBe(true);
    expect(toolResult!.content[0].text).toContain("Unknown tool 'NotARealTool'");
    expect(toolResult!.content[0].text).toContain('EchoTool');
  });

  it('lets the agent recover by calling a real tool after the hallucinated one', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('NotARealTool', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'hello' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator([EchoTool, PendingTool, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');

    const toolResults = orch.log.filter(
      (e) => 'role' in e && e.role === 'toolResult',
    ) as { toolName: string; isError: boolean; content: TextContent[] }[];
    expect(toolResults.map((t) => t.toolName)).toEqual(['NotARealTool', 'EchoTool']);
    expect(toolResults[0].isError).toBe(true);
    expect(toolResults[1].isError).toBe(false);
    expect(toolResults[1].content[0].text).toBe('echo: hello');
  });

  it('appends the unknown-tool error at the sub-agent parent_id, not the root', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'sub-go' })],
        { stopReason: 'toolUse' },
      ),
      // NestedAgent: hallucinate, then stop
      fauxAssistantMessage([fauxToolCall('NotInSubAgent', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('sub stopped', { stopReason: 'stop' }),
      // Root agent stop
      fauxAssistantMessage('root stopped', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator([EchoTool, PendingTool, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(root);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');

    const errorTrm = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'NotInSubAgent',
    ) as { parent_id: string; isError: boolean } | undefined;
    expect(errorTrm).toBeDefined();
    expect(errorTrm!.isError).toBe(true);
    // The error should NOT be at the root's id
    expect(errorTrm!.parent_id).not.toBe(root.id);
  });
});
