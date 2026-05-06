import { fauxAssistantMessage, fauxToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('sub-agent tool error', () => {
  it('error inside a sub-agent emits an error event with the sub-agent\'s parent_id and ends cleanly', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'go deeper' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        [fauxToolCall('ErrorTool', { reason: 'kaboom' })],
        { stopReason: 'toolUse' },
      ),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'trigger nested error' }, ctx);

    const stream = orch.run(root);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    const result = await stream.result();

    expect(result).toBeNull();

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { parent_id: string }).parent_id).toBe(root.id);

    const pendingEvent = events.find((e) => e.type === 'pending');
    expect(pendingEvent).toBeUndefined();

    const errToolResultInLog = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'ErrorTool',
    );
    expect(errToolResultInLog).toBeUndefined();
  });
});
