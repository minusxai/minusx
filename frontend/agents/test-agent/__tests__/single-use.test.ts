import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('Orchestrator single-use guard', () => {
  const ctx: AgentContext = { userId: 'u', mode: 'org' };
  const registrables = [EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent];

  it('run() then run() throws', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('done.', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent1 = new TestAgent(orch, { userMessage: 'one' }, ctx);
    const stream = orch.run(agent1);
    for await (const _ of stream) {/* drain */}
    await stream.result();

    const agent2 = new TestAgent(orch, { userMessage: 'two' }, ctx);
    expect(() => orch.run(agent2)).toThrow(/single-use/);
  });

  it('run() then resume() throws', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('done.', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'one' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    await stream.result();

    expect(() =>
      orch.resume([
        {
          role: 'toolResult',
          toolCallId: 'whatever',
          toolName: 'whatever',
          content: [{ type: 'text', text: '' }],
          isError: false,
          timestamp: Date.now(),
        },
      ]),
    ).toThrow(/single-use/);
  });

  it('resume() then resume() throws', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('PendingTool', { prompt: 'pause' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done.', { stopReason: 'stop' }),
    ]);

    const orchA = new Orchestrator(registrables);
    const agent = new TestAgent(orchA, { userMessage: 'one' }, ctx);
    const sa = orchA.run(agent);
    for await (const _ of sa) {/* drain */}

    const pendingId = orchA.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc) => tc.name === 'PendingTool')!.id;

    const orchB = new Orchestrator(registrables, orchA.log);
    const sb = orchB.resume([
      {
        role: 'toolResult',
        toolCallId: pendingId,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'k' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    for await (const _ of sb) {/* drain */}
    await sb.result();

    expect(() =>
      orchB.resume([
        {
          role: 'toolResult',
          toolCallId: pendingId,
          toolName: 'PendingTool',
          content: [{ type: 'text', text: 'k' }],
          isError: false,
          timestamp: Date.now(),
        },
      ]),
    ).toThrow(/single-use/);
  });
});
