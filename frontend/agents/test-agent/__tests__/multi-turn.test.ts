import type { TextContent, UserMessage } from '@/orchestrator/llm';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import { EchoTool, PendingTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('multi-turn root conversation', () => {
  it('second turn on a fresh orchestrator inherits the first turn via threadHistory', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('Reply to first.', { stopReason: 'stop' }),
      fauxAssistantMessage('Reply to second.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, NestedAgent, TestAgent];

    const orchA = new Orchestrator(registrables);
    const a1 = new TestAgent(orchA, { userMessage: 'first' }, ctx);
    const stream1 = orchA.run(a1);
    for await (const _ of stream1) {/* drain events */}
    const result1 = await stream1.result();
    expect(result1).not.toBeNull();
    expect((result1!.content[0] as TextContent).text).toBe('Reply to first.');

    const orchB = new Orchestrator(registrables, orchA.log);
    const a2 = new TestAgent(orchB, { userMessage: 'second' }, ctx);
    const stream2 = orchB.run(a2);
    for await (const _ of stream2) {/* drain events */}
    const result2 = await stream2.result();
    expect(result2).not.toBeNull();
    expect((result2!.content[0] as TextContent).text).toBe('Reply to second.');

    const history = a2.threadHistory;

    const firstUser = history.find((m): m is UserMessage => m.role === 'user');
    expect(firstUser).toBeDefined();
    expect(firstUser!.content).toBe('first');

    const firstAssistant = history.find((m) => m.role === 'assistant' && m.stopReason === 'stop');
    expect(firstAssistant).toBeDefined();
    expect((firstAssistant!.content[0] as TextContent).text).toBe('Reply to first.');
  });
});
