import { fauxAssistantMessage, fauxToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, PendingToolEvent, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('rich pending event + getPendingToolCalls', () => {
  it('emits a per-tool pending event with full info; getPendingToolCalls mirrors it from the log', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('PendingTool', { prompt: 'first' }),
          fauxToolCall('PendingTool', { prompt: 'second' }),
        ],
        { stopReason: 'toolUse' },
      ),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org', connectionId: 'c1' };
    const registrables = [EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent];
    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'two pending' }, ctx);

    const stream = orch.run(agent);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    await stream.result();

    const pendingEvents = events.filter((e): e is PendingToolEvent => e.type === 'pending');
    expect(pendingEvents).toHaveLength(2);

    for (const pe of pendingEvents) {
      expect(typeof pe.toolCallId).toBe('string');
      expect(pe.toolName).toBe('PendingTool');
      expect(typeof pe.parameters).toBe('object');
      expect(pe.parameters).toHaveProperty('prompt');
      expect(pe.context).toEqual(ctx);
      expect(pe.parent_id).toBe(agent.id);
    }

    const prompts = pendingEvents.map((pe) => (pe.parameters as { prompt: string }).prompt).sort();
    expect(prompts).toEqual(['first', 'second']);

    const pending = orch.getPendingToolCalls();
    expect(pending).toHaveLength(2);
    for (const p of pending) {
      expect(p.name).toBe('PendingTool');
      expect(p.context).toEqual(ctx);
      expect(p.parent_id).toBe(agent.id);
      expect(p.parameters).toHaveProperty('prompt');
    }

    const eventIds = pendingEvents.map((pe) => pe.toolCallId).sort();
    const logIds = pending.map((p) => p.id).sort();
    expect(eventIds).toEqual(logIds);
  });

  it('after a fully-resolved run, getPendingToolCalls returns []', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('Done.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent];
    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'hi' }, ctx);

    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    await stream.result();

    expect(orch.getPendingToolCalls()).toEqual([]);
  });
});
