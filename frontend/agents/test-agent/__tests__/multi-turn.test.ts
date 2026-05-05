import { fauxAssistantMessage, type TextContent, type UserMessage } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import { EchoTool, PendingTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('multi-turn root conversation', () => {
  it('second TestAgent on the same Orchestrator inherits the first turn via threadHistory', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('Reply to first.', { stopReason: 'stop' }),
      fauxAssistantMessage('Reply to second.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, NestedAgent, TestAgent]);

    const a1 = new TestAgent(orch, { userMessage: 'first' }, ctx);
    const stream1 = orch.run(a1);
    for await (const _ of stream1) {/* drain events */}
    const result1 = await stream1.result();
    expect(result1).not.toBeNull();
    expect((result1!.content[0] as TextContent).text).toBe('Reply to first.');

    const a2 = new TestAgent(orch, { userMessage: 'second' }, ctx);
    const stream2 = orch.run(a2);
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
