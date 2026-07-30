/**
 * LLM-boundary retry — orchestrator-level contracts for the PR #652 gaps:
 *
 *  1. A SILENT stream end (iterator finishes with neither `done` nor `error`) is a dropped stream
 *     too: it must route through the same retry policy (same attempt budget) instead of throwing
 *     `callLLM: LLM stream ended without done/error event` straight away.
 *  2. `emitted` only disqualifies a retry when USER-VISIBLE content streamed (text/thinking).
 *     Tool-call argument deltas never reach a user surface (the turn runner forwards only
 *     text/thinking deltas, and a failed attempt's partial is never committed to the log), so a
 *     drop mid-tool-call-args — the common agentic-turn case — IS re-issued.
 *  3. A sub-agent whose run throws becomes an `isError: true` tool RESULT on the parent's thread
 *     (mirroring the leaf-tool branch), so the parent agent reacts instead of the run hard-failing.
 *
 * The faux provider streams a message's content as deltas and can terminate with an error event
 * (`stopReason: 'error'`); silent ends are simulated by patching `streamSimple` at the boundary.
 */
import { vi } from 'vitest';

// Countdown of upcoming streamSimple calls that end SILENTLY (no done/error event). Hoisted so the
// module mock below can reference it.
const silent = vi.hoisted(() => ({ remaining: 0 }));

vi.mock('@/orchestrator/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/orchestrator/llm')>();
  const streamSimple: typeof actual.streamSimple = (model, context, options) => {
    if (silent.remaining > 0) {
      silent.remaining -= 1;
      const s = new actual.EventStream<never, null>(() => false, () => null);
      queueMicrotask(() => s.end(null));
      return s as unknown as ReturnType<typeof actual.streamSimple>;
    }
    return actual.streamSimple(model, context, options);
  };
  return { ...actual, streamSimple };
});

import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { MAX_LLM_CALL_RETRIES } from '@/orchestrator/llm/retry';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { ConversationLogEntry } from '@/orchestrator/types';
import {
  EchoTool,
  TypedTool,
  PendingTool,
  ErrorTool,
  NestedAgent,
  DeepAgent,
  TestAgent,
  fauxRegistration,
} from '@/agents/test-agent/test-agent';

const REGISTRABLES = [EchoTool, TypedTool, PendingTool, ErrorTool, NestedAgent, DeepAgent, TestAgent];
const STREAM_DROP = 'OpenAI Responses stream ended before a terminal response event';

interface RunOutcome {
  errors: string[];
  finalText: string | null;
  log: ConversationLogEntry[];
}

/** Drive one TestAgent turn through a fresh orchestrator, collecting stream errors + final text. */
async function runTurn(): Promise<RunOutcome> {
  const orch = new Orchestrator(REGISTRABLES);
  const agent = new TestAgent(orch, { userMessage: 'go' }, { userId: 'u' });
  const stream = orch.run(agent as never);
  const errors: string[] = [];
  for await (const ev of stream) {
    if ((ev as { type?: string }).type === 'error') {
      errors.push((ev as { error?: { errorMessage?: string } }).error?.errorMessage ?? 'unknown');
    }
  }
  await stream.result();
  const final = [...orch.log].reverse().find(
    (e): e is ConversationLogEntry & { role: 'assistant'; content: { type: string; text?: string }[] } =>
      'role' in e && e.role === 'assistant' && e.parent_id === agent.id && (e as { stopReason?: string }).stopReason === 'stop',
  );
  const finalText = final
    ? final.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
    : null;
  return { errors, finalText, log: orch.log };
}

beforeEach(() => {
  silent.remaining = 0;
  fauxRegistration.setResponses([]);
});

describe('silent stream end (no done/error event)', () => {
  it('is re-issued through the retry policy and the turn succeeds', async () => {
    silent.remaining = 1; // first call ends silently; the re-issue reaches the faux provider
    fauxRegistration.setResponses([fauxAssistantMessage('Recovered.', { stopReason: 'stop' })]);

    const { errors, finalText } = await runTurn();

    expect(errors).toEqual([]);
    expect(finalText).toBe('Recovered.');
  });

  it('respects the same attempt budget — persistent silent ends still fail the run', async () => {
    silent.remaining = 10; // more than 1 + MAX_LLM_CALL_RETRIES — every attempt ends silently
    fauxRegistration.setResponses([fauxAssistantMessage('never reached', { stopReason: 'stop' })]);

    const { errors, finalText } = await runTurn();

    expect(finalText).toBeNull();
    expect(errors.some((m) => /ended without done\/error event/.test(m))).toBe(true);
    // Budget bound: 1 initial + MAX_LLM_CALL_RETRIES re-issues were consumed, no more.
    expect(silent.remaining).toBe(10 - (1 + MAX_LLM_CALL_RETRIES));
  });
});

describe('retry after emission — user-visible vs tool-arg deltas', () => {
  it('re-issues a drop that only streamed TOOL-CALL argument deltas (nothing user-visible)', async () => {
    fauxRegistration.setResponses([
      // Attempt 1: streams toolcall deltas, then terminates as a transient stream error.
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'hi' })], { stopReason: 'error', errorMessage: STREAM_DROP }),
      // The re-issue: the same tool call, completing normally.
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'hi' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done after retry', { stopReason: 'stop' }),
    ]);

    const { errors, finalText, log } = await runTurn();

    expect(errors).toEqual([]);
    expect(finalText).toBe('done after retry');
    // The retried call's tool actually executed.
    const echoResult = log.find((e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'EchoTool');
    expect(echoResult).toBeDefined();
  });

  it('does NOT re-issue a drop after user-visible TEXT streamed (would garble the in-flight reply)', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('here is some partial output', { stopReason: 'error', errorMessage: STREAM_DROP }),
      fauxAssistantMessage('should never be consumed', { stopReason: 'stop' }),
    ]);

    const { errors, finalText } = await runTurn();

    expect(finalText).toBeNull();
    expect(errors.some((m) => m.includes(STREAM_DROP))).toBe(true);
  });
});

describe('sub-agent failure becomes an error tool result', () => {
  it('parent receives isError toolResult for the dispatched sub-agent and continues', async () => {
    fauxRegistration.setResponses([
      // Parent (TestAgent) dispatches the NestedAgent sub-agent.
      fauxAssistantMessage([fauxToolCall('NestedAgent', { userMessage: 'dig deeper' })], { stopReason: 'toolUse' }),
      // NestedAgent's LLM call fails with a NON-retryable error → its run() throws.
      () => { throw new Error('synthetic terminal failure'); },
      // Parent sees the error result and recovers.
      fauxAssistantMessage('recovered after sub-agent failure', { stopReason: 'stop' }),
    ]);

    const { errors, finalText, log } = await runTurn();

    // No hard run failure surfaced.
    expect(errors).toEqual([]);
    expect(finalText).toBe('recovered after sub-agent failure');

    // The dispatch tool call reached a COMPLETED state: an isError toolResult on the parent thread.
    const trm = log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'NestedAgent',
    ) as (ConversationLogEntry & { role: 'toolResult'; isError: boolean; content: { type: string; text?: string }[] }) | undefined;
    expect(trm).toBeDefined();
    expect(trm!.isError).toBe(true);
    expect(trm!.content.some((c) => c.type === 'text' && /synthetic terminal failure/.test(c.text ?? ''))).toBe(true);
  });
});
