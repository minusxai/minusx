import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('cancel in-flight', () => {
  it('cancel() aborts a running orchestrator; stream emits an error event with the agent\'s parent_id', async () => {
    fauxRegistration.setResponses([
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return fauxAssistantMessage('would have stopped.', { stopReason: 'stop' });
      },
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'will be cancelled' }, ctx);

    const stream = orch.run(agent);

    setTimeout(() => orch.cancel(), 10);

    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    const result = await stream.result();

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { parent_id: string }).parent_id).toBe(agent.id);
    expect(result).toBeNull();
  });
});
