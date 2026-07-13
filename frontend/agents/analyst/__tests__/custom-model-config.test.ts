// Model config is DB-only (org config `llm` section) — these tests pin the
// STATIC substrate under the per-call plan resolver: faux models in test envs
// (never in production), and the MinusX-gateway default in production, plus
// the custom-endpoint model builder used by `custom` provider entries.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildCustomModel, getModel } from '@/orchestrator/llm';
import type { Api, Model } from '@/orchestrator/llm';
import { getAgentModelOrTestFallback, getAnalystModelOptions } from '@/agents/analyst/model-config';
import { getMicroModelOrTestFallback, getMicroModelOptions } from '@/agents/micro/model-config';
import { MX_USE_CASE_HEADER } from '@/lib/llm/llm-config-types';
import { MINUSX_AUTO_MODEL } from '@/lib/llm/minusx-default';

const FAUX = { id: 'faux', provider: 'faux', api: 'faux' } as unknown as Model<Api>;

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Simulate a production process (vitest sets VITEST + NODE_ENV=test). */
function stubProductionEnv() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VITEST', '');
}

describe('buildCustomModel', () => {
  it('builds an OpenAI-compatible model from a minimal spec with safe defaults', () => {
    const model = buildCustomModel({ baseUrl: 'http://localhost:11434/v1', id: 'qwen3:32b' });
    expect(model.baseUrl).toBe('http://localhost:11434/v1');
    expect(model.id).toBe('qwen3:32b');
    expect(model.api).toBe('openai-completions');
    expect(model.provider).toBe('custom');
    expect(model.reasoning).toBe(false);
    expect(model.input).toEqual(['text']);
    expect(model.contextWindow).toBe(128_000);
    expect(model.maxTokens).toBe(8_192);
    expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('honors explicit spec fields', () => {
    const model = buildCustomModel({
      baseUrl: 'http://vllm.internal:8000/v1',
      id: 'llama-3.3-70b',
      api: 'openai-completions',
      name: 'Llama 3.3 70B (vLLM)',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 32_768,
      maxTokens: 4_096,
      headers: { 'x-team': 'data' },
    });
    expect(model.name).toBe('Llama 3.3 70B (vLLM)');
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(['text', 'image']);
    expect(model.contextWindow).toBe(32_768);
    expect(model.maxTokens).toBe(4_096);
    expect(model.headers).toEqual({ 'x-team': 'data' });
  });

  it('rejects specs missing baseUrl or id', () => {
    expect(() => buildCustomModel({ baseUrl: '', id: 'x' })).toThrow(/baseUrl/);
    expect(() => buildCustomModel({ baseUrl: 'http://x', id: '' })).toThrow(/id/);
  });
});

describe('getModel with unknown provider', () => {
  it('throws an informative error instead of returning undefined', () => {
    expect(() => getModel('ollama', 'llama3')).toThrow(/customModel/);
  });
});

describe('static agent models (substrate under the DB plan resolver)', () => {
  it('test environments get the faux model and no static options', () => {
    expect(getAgentModelOrTestFallback(FAUX)).toBe(FAUX);
    expect(getMicroModelOrTestFallback(FAUX)).toBe(FAUX);
    expect(getAnalystModelOptions()).toBeUndefined();
    expect(getMicroModelOptions()).toBeUndefined();
  });

  it('production defaults to the MinusX gateway model (never faux, never another vendor)', () => {
    stubProductionEnv();
    const analyst = getAgentModelOrTestFallback(FAUX);
    expect(analyst.provider).toBe('minusx');
    expect(analyst.id).toBe(MINUSX_AUTO_MODEL);
    expect((analyst as { baseUrl?: string }).baseUrl).toContain('/v1');

    const micro = getMicroModelOrTestFallback(FAUX);
    expect(micro.provider).toBe('minusx');
  });

  it('production static options carry the use-case routing header', () => {
    stubProductionEnv();
    expect((getAnalystModelOptions()?.headers as Record<string, string>)[MX_USE_CASE_HEADER]).toBe('analyst');
    expect((getMicroModelOptions()?.headers as Record<string, string>)[MX_USE_CASE_HEADER]).toBe('micro');
  });
});
