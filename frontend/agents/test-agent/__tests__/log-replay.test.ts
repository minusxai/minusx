import { fauxAssistantMessage, type TextContent, type UserMessage } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, ConversationLog } from '@/orchestrator/types';
import { EchoTool, PendingTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('log replay (stateless rehydration)', () => {
  it('serializes log, rehydrates into a fresh Orchestrator, second run sees prior turn', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('First reply.', { stopReason: 'stop' }),
      fauxAssistantMessage('Second reply.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, NestedAgent, TestAgent];

    const orchA = new Orchestrator(registrables);
    const a1 = new TestAgent(orchA, { userMessage: 'first' }, ctx);
    const streamA = orchA.run(a1);
    for await (const _ of streamA) {/* drain */}
    const result1 = await streamA.result();
    expect(result1).not.toBeNull();
    expect((result1!.content[0] as TextContent).text).toBe('First reply.');

    const serialized = JSON.stringify(orchA.log);
    const rehydratedLog: ConversationLog = JSON.parse(serialized);

    const orchB = new Orchestrator(registrables, rehydratedLog);
    const a2 = new TestAgent(orchB, { userMessage: 'second' }, ctx);
    const streamB = orchB.run(a2);
    for await (const _ of streamB) {/* drain */}
    const result2 = await streamB.result();
    expect(result2).not.toBeNull();
    expect((result2!.content[0] as TextContent).text).toBe('Second reply.');

    const firstUser = a2.threadHistory.find((m): m is UserMessage => m.role === 'user');
    expect(firstUser).toBeDefined();
    expect(firstUser!.content).toBe('first');

    const firstAssistant = a2.threadHistory.find(
      (m) => m.role === 'assistant' && m.stopReason === 'stop',
    );
    expect(firstAssistant).toBeDefined();
    expect((firstAssistant!.content[0] as TextContent).text).toBe('First reply.');
  });
});
