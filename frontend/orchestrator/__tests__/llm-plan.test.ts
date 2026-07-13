// DB-backed LLM plans: the app installs `orchestrator.resolveLlmPlan`; callLLM
// consults it per call (keyed by use case), uses the plan's model/options over
// the agent's static ones, and falls back down the chain on early failures —
// but never after content has already streamed to the client.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as llm from '@/orchestrator/llm';
import { Orchestrator } from '../orchestrator';
import type { LlmPlanStep } from '../types';

afterEach(() => vi.restoreAllMocks());

type StreamScript = Array<Record<string, unknown>>;

/** Stub streamSimple: each call consumes the next script; records (model, options). */
function stubStreamScripts(scripts: StreamScript[]) {
  const calls: Array<{ model: unknown; options?: Record<string, unknown> }> = [];
  vi.spyOn(llm, 'streamSimple').mockImplementation(((model: unknown, _ctx: unknown, options?: Record<string, unknown>) => {
    calls.push({ model, options });
    const script = scripts[Math.min(calls.length - 1, scripts.length - 1)];
    return (async function* () { yield* script; })();
  }) as never);
  return calls;
}

const DONE = (text = 'ok') => ({
  type: 'done',
  message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
});
const ERROR = (msg = 'boom') => ({
  type: 'error',
  error: { role: 'assistant', content: [], stopReason: 'error', errorMessage: msg },
});
const TEXT_DELTA = { type: 'text_delta', contentIndex: 0, delta: 'partial', partial: { role: 'assistant', content: [] } };

const staticModel = { id: 'static-model' } as never;
const planModel = (id: string) => ({ id }) as never;

describe('Orchestrator.callLLM — plan resolution', () => {
  it('without a resolver, uses the requested static model (existing behavior)', async () => {
    const calls = stubStreamScripts([[DONE()]]);
    const orch = new Orchestrator([]);
    await orch.callLLM(staticModel, {} as never, 'agent-1');
    expect((calls[0].model as { id: string }).id).toBe('static-model');
  });

  it('uses the plan model and merges plan options over agent options', async () => {
    const calls = stubStreamScripts([[DONE()]]);
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async () => [
      { model: planModel('db-model'), callOptions: { apiKey: 'k1', reasoning: 'high' } },
    ] as LlmPlanStep[];
    await orch.callLLM(staticModel, {} as never, 'agent-1', { reasoning: 'low', maxRetryDelayMs: 5 });
    expect((calls[0].model as { id: string }).id).toBe('db-model');
    expect(calls[0].options?.apiKey).toBe('k1');
    expect(calls[0].options?.reasoning).toBe('high');       // plan wins on conflict
    expect(calls[0].options?.maxRetryDelayMs).toBe(5);      // agent-only keys survive
  });

  it('passes the use case to the resolver (default analyst)', async () => {
    stubStreamScripts([[DONE()]]);
    const seen: string[] = [];
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async (useCase) => { seen.push(useCase); return []; };
    await orch.callLLM(staticModel, {} as never, 'agent-1');
    await orch.callLLM(staticModel, {} as never, 'agent-1', undefined, 'micro');
    expect(seen).toEqual(['analyst', 'micro']);
  });

  it('an empty plan falls back to the static model', async () => {
    const calls = stubStreamScripts([[DONE()]]);
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async () => [];
    await orch.callLLM(staticModel, {} as never, 'agent-1');
    expect((calls[0].model as { id: string }).id).toBe('static-model');
  });
});

describe('Orchestrator.callLLM — fallback chain', () => {
  it('falls back to the next step when the primary fails before streaming content', async () => {
    const calls = stubStreamScripts([[ERROR('auth failed')], [DONE('from fallback')]]);
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async () => [
      { model: planModel('primary') },
      { model: planModel('fallback') },
    ];
    const msg = await orch.callLLM(staticModel, {} as never, 'agent-1');
    expect(calls.map(c => (c.model as { id: string }).id)).toEqual(['primary', 'fallback']);
    expect((msg.content[0] as { text: string }).text).toBe('from fallback');
  });

  it('throws when every step in the chain fails', async () => {
    stubStreamScripts([[ERROR('down')], [ERROR('also down')]]);
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async () => [{ model: planModel('a') }, { model: planModel('b') }];
    await expect(orch.callLLM(staticModel, {} as never, 'agent-1')).rejects.toThrow(/also down/);
  });

  it('does NOT fall back after content already streamed (mid-stream failure = turn error)', async () => {
    const calls = stubStreamScripts([[TEXT_DELTA, ERROR('mid-stream')], [DONE('should not happen')]]);
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async () => [{ model: planModel('a') }, { model: planModel('b') }];
    await expect(orch.callLLM(staticModel, {} as never, 'agent-1')).rejects.toThrow(/mid-stream/);
    expect(calls).toHaveLength(1); // fallback never attempted
  });

  it('a single-step plan that fails throws (no synthetic fallback to the static model)', async () => {
    const calls = stubStreamScripts([[ERROR('down')]]);
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async () => [{ model: planModel('only') }];
    await expect(orch.callLLM(staticModel, {} as never, 'agent-1')).rejects.toThrow(/down/);
    expect(calls).toHaveLength(1);
  });
});
