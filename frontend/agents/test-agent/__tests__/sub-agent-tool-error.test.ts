import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('sub-agent tool error', () => {
  it('tool error inside a sub-agent appends an isError toolResult; sub-agent stops and bubbles up cleanly', async () => {
    fauxRegistration.setResponses([
      // Root: dispatch NestedAgent.
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'go deeper' })],
        { stopReason: 'toolUse' },
      ),
      // Inside NestedAgent: call ErrorTool.
      fauxAssistantMessage(
        [fauxToolCall('ErrorTool', { reason: 'kaboom' })],
        { stopReason: 'toolUse' },
      ),
      // NestedAgent sees the error; stop.
      fauxAssistantMessage('Sub-agent saw the error and stopped.', { stopReason: 'stop' }),
      // Root sees NestedAgent's reply; stop.
      fauxAssistantMessage('Root acknowledges the sub-agent error.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'trigger nested error' }, ctx);

    const stream = orch.run(root);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    const result = await stream.result();

    // Stream completes with the root agent's stop reply — sub-agent's tool
    // error didn't kill the turn.
    expect(result).not.toBeNull();
    expect(result?.stopReason).toBe('stop');

    // No pending events from the sub-agent's tool error — server tools
    // never get reported as pending after my orchestrator fix.
    const pendingEvent = events.find((e) => e.type === 'pending');
    expect(pendingEvent).toBeUndefined();

    // ErrorTool's failure IS recorded in the log as an isError toolResult.
    const errToolResultInLog = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'ErrorTool',
    );
    expect(errToolResultInLog).toBeDefined();
    expect((errToolResultInLog as { isError?: boolean }).isError).toBe(true);

    // getPendingToolCalls returns nothing — agent saw the error and stopped.
    expect(orch.getPendingToolCalls()).toEqual([]);
  });
});
