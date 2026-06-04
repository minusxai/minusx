/**
 * Phase 2 — the content-keyed faux matcher driving a REAL orchestration path
 * (Tests/QA/Evals Arch V2). Proves `setFauxMatches` + `after:` disambiguation
 * work end-to-end through the orchestrator + faux provider, not just in unit
 * tests. This is the reference pattern node e2e tests should follow.
 */
import { describe, it, expect } from 'vitest';
import type { TextContent } from '@/orchestrator/llm';
import {
  fauxAssistantMessage,
  fauxToolCall,
  setFauxMatches,
  respondTo,
} from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

const MSG = 'echo please';

async function runTurn(userMessage: string) {
  const ctx: AgentContext = { userId: 'u', mode: 'org' };
  const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);
  const agent = new TestAgent(orch, { userMessage }, ctx);
  const stream = orch.run(agent);
  const events: StreamEvent[] = [];
  for await (const ev of stream) events.push(ev);
  return { result: await stream.result(), events };
}

describe('faux matcher — multi-step tool loop via `after`', () => {
  it('keys two responses on the SAME user message, disambiguated by the tool that ran', async () => {
    // Same message "echo please":
    //   call #1 (after ∅)        → call EchoTool
    //   call #2 (after EchoTool) → stop with the final reply
    setFauxMatches(fauxRegistration, [
      respondTo(MSG, fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'hi' })], { stopReason: 'toolUse' })),
      respondTo(MSG, fauxAssistantMessage('all done', { stopReason: 'stop' }), { after: 'EchoTool' }),
    ]);

    const { result } = await runTurn(MSG);

    expect(result).not.toBeNull();
    expect((result!.content[0] as TextContent).text).toBe('all done');
  });

  it('a single-pass turn matches the message-only registration', async () => {
    setFauxMatches(fauxRegistration, [respondTo(MSG, fauxAssistantMessage('quick reply', { stopReason: 'stop' }))]);
    const { result } = await runTurn(MSG);
    expect((result!.content[0] as TextContent).text).toBe('quick reply');
  });

  it('fails loud when the model makes an unregistered call (orchestrator surfaces an error)', async () => {
    // Only the first call is registered; after EchoTool runs there is no match,
    // so the second call throws UnexpectedFauxLLMError inside the provider.
    setFauxMatches(fauxRegistration, [
      respondTo(MSG, fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'hi' })], { stopReason: 'toolUse' })),
    ]);

    const { result, events } = await runTurn(MSG);

    const errored =
      events.some((e) => e.type === 'error') ||
      result === null ||
      result?.stopReason === 'error';
    expect(errored).toBe(true);
  });
});
