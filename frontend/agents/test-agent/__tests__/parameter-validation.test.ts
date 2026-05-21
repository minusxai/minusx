import type { TextContent } from '@/orchestrator/llm';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import { EchoTool, PendingTool, TestAgent, fauxRegistration } from '../test-agent';

const ctx: AgentContext = { userId: 'u', mode: 'org' };
const registrables = [EchoTool, PendingTool, TestAgent];

function getToolResults(orch: Orchestrator) {
  return orch.log.filter(
    (e) => 'role' in e && e.role === 'toolResult',
  ) as { toolName: string; isError: boolean; content: TextContent[] }[];
}

describe('parameter validation', () => {
  it('rejects wrong-type parameters with a recoverable error', async () => {
    fauxRegistration.setResponses([
      // EchoTool expects { text: string }, LLM passes a number
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 123 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('giving up', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    const trms = getToolResults(orch);
    expect(trms).toHaveLength(1);
    expect(trms[0].toolName).toBe('EchoTool');
    expect(trms[0].isError).toBe(true);
    expect(trms[0].content[0].text).toMatch(/Invalid parameters for 'EchoTool'/);
    expect(trms[0].content[0].text.toLowerCase()).toContain('string');
  });

  it('rejects missing required parameters with a recoverable error', async () => {
    fauxRegistration.setResponses([
      // EchoTool requires `text`, LLM omits it
      fauxAssistantMessage([fauxToolCall('EchoTool', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('giving up', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    const trms = getToolResults(orch);
    expect(trms).toHaveLength(1);
    expect(trms[0].isError).toBe(true);
    expect(trms[0].content[0].text.toLowerCase()).toContain('text');
  });

  it('passes valid input through unchanged (regression check)', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'hello' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    const trms = getToolResults(orch);
    expect(trms).toHaveLength(1);
    expect(trms[0].isError).toBe(false);
    expect(trms[0].content[0].text).toBe('echo: hello');
  });

  it('lets the agent recover with a valid call after a validation error', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 42 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'second try' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    const trms = getToolResults(orch);
    expect(trms.map((t) => t.isError)).toEqual([true, false]);
    expect(trms[1].content[0].text).toBe('echo: second try');
  });
});
