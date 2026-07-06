import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildCustomModel, getModel } from '@/orchestrator/llm';
import type { Api, Model } from '@/orchestrator/llm';
import { getAgentModelOrTestFallback, getAnalystModelOptions } from '@/agents/analyst/model-config';
import { getMicroModelOrTestFallback } from '@/agents/micro/model-config';

const FAUX = { id: 'faux', provider: 'faux', api: 'faux' } as unknown as Model<Api>;

afterEach(() => {
  vi.unstubAllEnvs();
});

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

describe('agent model config with customModel', () => {
  it('analyst config resolves a custom endpoint model', () => {
    vi.stubEnv('ANALYST_AGENT_MODEL_CONFIG', JSON.stringify({
      customModel: { baseUrl: 'http://localhost:11434/v1', id: 'qwen3:32b' },
    }));
    const model = getAgentModelOrTestFallback(FAUX);
    expect(model.baseUrl).toBe('http://localhost:11434/v1');
    expect(model.id).toBe('qwen3:32b');
    expect(model.provider).toBe('custom');
  });

  it('micro config resolves a custom endpoint model', () => {
    vi.stubEnv('MICRO_AGENT_MODEL_CONFIG', JSON.stringify({
      customModel: { baseUrl: 'http://localhost:8000/v1', id: 'small-model' },
    }));
    const model = getMicroModelOrTestFallback(FAUX);
    expect(model.baseUrl).toBe('http://localhost:8000/v1');
    expect(model.id).toBe('small-model');
  });

  it('registry-based config still works alongside the custom path', () => {
    vi.stubEnv('ANALYST_AGENT_MODEL_CONFIG', JSON.stringify({
      provider: 'anthropic', model: 'claude-sonnet-4-6',
    }));
    const model = getAgentModelOrTestFallback(FAUX);
    expect(model.provider).toBe('anthropic');
  });

  it('injects apiKey from customModel.apiKeyEnv into call options', () => {
    vi.stubEnv('MY_LLM_KEY', 'sk-local-123');
    vi.stubEnv('ANALYST_AGENT_MODEL_CONFIG', JSON.stringify({
      customModel: { baseUrl: 'http://vllm:8000/v1', id: 'm', apiKeyEnv: 'MY_LLM_KEY' },
      options: { temperature: 0 },
    }));
    expect(getAnalystModelOptions()).toEqual({ temperature: 0, apiKey: 'sk-local-123' });
  });

  it('an explicit options.apiKey wins over apiKeyEnv', () => {
    vi.stubEnv('MY_LLM_KEY', 'sk-env');
    vi.stubEnv('ANALYST_AGENT_MODEL_CONFIG', JSON.stringify({
      customModel: { baseUrl: 'http://vllm:8000/v1', id: 'm', apiKeyEnv: 'MY_LLM_KEY' },
      options: { apiKey: 'sk-explicit' },
    }));
    expect(getAnalystModelOptions()).toEqual({ apiKey: 'sk-explicit' });
  });
});
