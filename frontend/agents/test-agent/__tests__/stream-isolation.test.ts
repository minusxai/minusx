import { fauxAssistantMessage } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('stream isolation across concurrent runs', () => {
  it('events from agent A never leak into agent B\'s stream when run() is called mid-flight', async () => {
    fauxRegistration.setResponses([
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        return fauxAssistantMessage('A done.', { stopReason: 'stop' });
      },
      fauxAssistantMessage('B done.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);

    const agentA = new TestAgent(orch, { userMessage: 'A' }, ctx);
    const streamA = orch.run(agentA);
    const eventsA: StreamEvent[] = [];
    const drainA = (async () => {
      for await (const ev of streamA) eventsA.push(ev);
    })();

    await new Promise((r) => setTimeout(r, 5));

    const agentB = new TestAgent(orch, { userMessage: 'B' }, ctx);
    const streamB = orch.run(agentB);
    const eventsB: StreamEvent[] = [];
    for await (const ev of streamB) eventsB.push(ev);

    await drainA;

    const isAssistantEvent = (e: StreamEvent): e is StreamEvent & { parent_id: string } =>
      e.type !== 'pending';

    const aLeakIntoB = eventsB.filter(isAssistantEvent).filter((e) => e.parent_id !== agentB.id);
    expect(aLeakIntoB).toEqual([]);

    const bLeakIntoA = eventsA.filter(isAssistantEvent).filter((e) => e.parent_id !== agentA.id);
    expect(bLeakIntoA).toEqual([]);
  });
});
