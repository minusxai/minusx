import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('tool error propagation (non-UserInputException)', () => {
  it('appends an isError toolResult to the log so the agent can recover; tool is NOT reported as pending', async () => {
    // Turn 1: agent calls ErrorTool which throws.
    // Turn 2: agent stops cleanly. Without this stop, the orchestrator would
    // loop forever calling LLM with an error result. The faux response
    // simulates the model deciding "ok, just stop" after seeing the error.
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('ErrorTool', { reason: 'boom' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Tool failed; stopping.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'trigger error' }, ctx);

    const stream = orch.run(agent);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    const result = await stream.result();

    // Stream completes cleanly with the agent's final stop message.
    expect(result).not.toBeNull();
    expect(result?.stopReason).toBe('stop');

    // The error toolResult IS present in the log — agent saw it and decided
    // to stop. This is what prevents `getPendingToolCalls()` from
    // misreporting the failed tool as pending (which would cause the
    // frontend to try to bridge a server-side tool).
    const errToolResult = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'ErrorTool',
    );
    expect(errToolResult).toBeDefined();
    expect((errToolResult as { isError?: boolean }).isError).toBe(true);

    // No pending events — server tool failures don't pause the orchestrator.
    const pendingEvent = events.find((e) => e.type === 'pending');
    expect(pendingEvent).toBeUndefined();

    // And critically: getPendingToolCalls() doesn't include the failed tool.
    const pending = orch.getPendingToolCalls();
    expect(pending.find((p) => p.name === 'ErrorTool')).toBeUndefined();
  });
});
