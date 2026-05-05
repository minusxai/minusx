import { fauxAssistantMessage, fauxToolCall, type TextContent, type ToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('parallel mixed-state dispatch', () => {
  it('runs two parallel tool_calls; one succeeds, one pauses; resume completes', async () => {
    fauxRegistration.setResponses([
      // Turn 1: emit BOTH an EchoTool call (succeeds) and a PendingTool call (UIE).
      fauxAssistantMessage(
        [
          fauxToolCall('EchoTool', { text: 'parallel hello' }),
          fauxToolCall('PendingTool', { prompt: 'frontend please' }),
        ],
        { stopReason: 'toolUse' },
      ),
      // Turn 2 (after resume): final stop reply.
      fauxAssistantMessage('Both done.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, NestedAgent, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'parallel test' }, ctx);

    // Phase 1: run → expect a 'pending' event (PendingTool's id), no final result.
    const phase1 = orch.run(agent);
    const events1: StreamEvent[] = [];
    for await (const ev of phase1) events1.push(ev);
    const result1 = await phase1.result();

    expect(result1).toBeNull();
    const pendingEvent = events1.find((e) => e.type === 'pending');
    expect(pendingEvent).toBeDefined();

    // Both tool_calls live in the same AssistantMessage; one was resolved
    // (EchoTool's result is in the log), the other isn't.
    const echoResult = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'EchoTool',
    );
    const pendingResult = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'PendingTool',
    );
    expect(echoResult).toBeDefined();
    expect(pendingResult).toBeUndefined();

    // Locate the pending tool call to resume.
    const pendingCall = orch.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(pendingCall).toBeDefined();

    // Phase 2: resume → expect final AssistantMessage.
    const phase2 = orch.resume([
      {
        toolCallId: pendingCall!.id,
        response: { content: [{ type: 'text', text: 'frontend done' }], isError: false },
      },
    ]);
    const events2: StreamEvent[] = [];
    for await (const ev of phase2) events2.push(ev);
    const result2 = await phase2.result();

    expect(result2).not.toBeNull();
    expect(result2!.role).toBe('assistant');
    expect(result2!.stopReason).toBe('stop');
    expect((result2!.content[0] as TextContent).text).toContain('Both done.');
  });
});
