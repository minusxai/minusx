import { fauxAssistantMessage, fauxToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('tool error propagation (non-UserInputException)', () => {
  it('emits error event and ends the stream cleanly when a tool throws', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('ErrorTool', { reason: 'boom' })],
        { stopReason: 'toolUse' },
      ),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'trigger error' }, ctx);

    const stream = orch.run(agent);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    const result = await stream.result();

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(result).toBeNull();

    const errToolResult = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'ErrorTool',
    );
    expect(errToolResult).toBeUndefined();

    const pendingEvent = events.find((e) => e.type === 'pending');
    expect(pendingEvent).toBeUndefined();
  });
});
