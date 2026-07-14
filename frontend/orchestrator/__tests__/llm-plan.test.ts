// DB-backed LLM plans: the app installs `orchestrator.resolveLlmPlan`; callLLM
// consults it per call (keyed by use case) and uses the plan's model/options
// over the agent's static ones. One model per use case — no fallback chains.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as llm from '@/orchestrator/llm';
import { Orchestrator } from '../orchestrator';

afterEach(() => vi.restoreAllMocks());

/** Stub streamSimple; record (model, options); yield one done message. */
function stubStream() {
  const calls: Array<{ model: unknown; options?: Record<string, unknown> }> = [];
  vi.spyOn(llm, 'streamSimple').mockImplementation(((model: unknown, _ctx: unknown, options?: Record<string, unknown>) => {
    calls.push({ model, options });
    return (async function* () {
      yield { type: 'done', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' } };
    })();
  }) as never);
  return calls;
}

const staticModel = { id: 'static-model' } as never;

describe('Orchestrator.callLLM — plan resolution', () => {
  it('without a resolver, uses the requested static model (existing behavior)', async () => {
    const calls = stubStream();
    const orch = new Orchestrator([]);
    await orch.callLLM(staticModel, {} as never, 'agent-1');
    expect((calls[0].model as { id: string }).id).toBe('static-model');
  });

  it('uses the plan model and merges plan options over agent options', async () => {
    const calls = stubStream();
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async () => ({
      model: { id: 'db-model' } as never,
      callOptions: { apiKey: 'k1', reasoning: 'high' },
    });
    await orch.callLLM(staticModel, {} as never, 'agent-1', { reasoning: 'low', maxRetryDelayMs: 5 });
    expect((calls[0].model as { id: string }).id).toBe('db-model');
    expect(calls[0].options?.apiKey).toBe('k1');
    expect(calls[0].options?.reasoning).toBe('high');       // plan wins on conflict
    expect(calls[0].options?.maxRetryDelayMs).toBe(5);      // agent-only keys survive
  });

  it('passes the use case to the resolver (default analyst)', async () => {
    stubStream();
    const seen: string[] = [];
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async (useCase) => { seen.push(useCase); return null; };
    await orch.callLLM(staticModel, {} as never, 'agent-1');
    await orch.callLLM(staticModel, {} as never, 'agent-1', undefined, 'micro');
    expect(seen).toEqual(['analyst', 'micro']);
  });

  it('a null plan falls back to the static model', async () => {
    const calls = stubStream();
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async () => null;
    await orch.callLLM(staticModel, {} as never, 'agent-1');
    expect((calls[0].model as { id: string }).id).toBe('static-model');
  });

  it('a plan-model failure surfaces as the turn error (no silent fallback)', async () => {
    vi.spyOn(llm, 'streamSimple').mockImplementation((() => (async function* () {
      yield { type: 'error', error: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'auth failed' } };
    })()) as never);
    const orch = new Orchestrator([]);
    orch.resolveLlmPlan = async () => ({ model: { id: 'db-model' } as never });
    await expect(orch.callLLM(staticModel, {} as never, 'agent-1')).rejects.toThrow(/auth failed/);
  });
});
