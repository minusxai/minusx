import type { TextContent, ToolCall } from '@/orchestrator/llm';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('parallel mixed-state dispatch', () => {
  it('runs two parallel tool_calls; one succeeds, one pauses; resume completes', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('EchoTool', { text: 'parallel hello' }),
          fauxToolCall('PendingTool', { prompt: 'frontend please' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Both done.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, NestedAgent, TestAgent];
    const orchA = new Orchestrator(registrables);
    const agent = new TestAgent(orchA, { userMessage: 'parallel test' }, ctx);

    const phase1 = orchA.run(agent);
    const events1: StreamEvent[] = [];
    for await (const ev of phase1) events1.push(ev);
    const result1 = await phase1.result();

    expect(result1).toBeNull();
    const pendingEvent = events1.find((e) => e.type === 'pending');
    expect(pendingEvent).toBeDefined();

    const echoResult = orchA.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'EchoTool',
    );
    const pendingResult = orchA.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'PendingTool',
    );
    expect(echoResult).toBeDefined();
    expect(pendingResult).toBeUndefined();

    const pendingCall = orchA.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(pendingCall).toBeDefined();

    const orchB = new Orchestrator(registrables, orchA.log);
    const phase2 = orchB.resume([
      {
        role: 'toolResult',
        toolCallId: pendingCall!.id,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'frontend done' }],
        isError: false,
        timestamp: Date.now(),
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
