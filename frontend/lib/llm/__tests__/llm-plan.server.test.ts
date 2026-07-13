// DB-backed plan resolution: reads the org config's `llm` section, resolves
// @SECRETS refs to raw keys, and maps provider entries + model choices onto
// executable plan steps (registry / bedrock / custom / minusx).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { saveRawConfig, getRawConfig } from '@/lib/data/configs.server';
import { isSecretRef } from '@/lib/secrets/config-secret-specs';
import { resolveLlmPlan, buildPlanStep } from '../llm-plan.server';
import { MX_USE_CASE_HEADER, type LlmConfig } from '../llm-config-types';
import { MINUSX_AUTO_MODEL } from '../minusx-default';

const dbPath = getTestDbPath('llm_plan_server');
beforeAll(async () => { await initTestDatabase(dbPath); });
afterAll(async () => { await cleanupTestDatabase(dbPath); });

async function setLlmConfig(llm: LlmConfig | undefined) {
  const raw = await getRawConfig('org');
  await saveRawConfig('org', { ...raw, llm } as never);
}

describe('resolveLlmPlan', () => {
  it('returns [] for an unconfigured workspace in TEST envs (agents keep faux models)', async () => {
    await setLlmConfig(undefined);
    expect(await resolveLlmPlan('org', 'analyst')).toEqual([]);
  });

  it('defaults an unconfigured workspace to the MinusX gateway in production (no env tier, no vendor default)', async () => {
    await setLlmConfig(undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    try {
      const plan = await resolveLlmPlan('org', 'micro');
      expect(plan).toHaveLength(1);
      const model = plan[0].model as { provider: string; id: string };
      expect(model.provider).toBe('minusx');
      expect(model.id).toBe(MINUSX_AUTO_MODEL);
      expect((plan[0].callOptions?.headers as Record<string, string>)[MX_USE_CASE_HEADER]).toBe('micro');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('resolves an assignment chain with secret-resolved API keys', async () => {
    await setLlmConfig({
      providers: [{ name: 'main-anthropic', provider: 'anthropic', apiKey: 'sk-ant-raw-key' }],
      assignments: {
        analyst: { chain: [{ providerName: 'main-anthropic', model: 'claude-sonnet-4-6', options: { reasoning: 'low' } }] },
      },
    });

    // The stored doc holds a ref, not the raw key (extraction ran on save).
    const stored = (await getRawConfig('org')).llm as LlmConfig;
    expect(isSecretRef(stored.providers![0].apiKey)).toBe(true);

    const plan = await resolveLlmPlan('org', 'analyst');
    expect(plan).toHaveLength(1);
    expect((plan[0].model as { id: string }).id).toBe('claude-sonnet-4-6');
    expect(plan[0].callOptions?.apiKey).toBe('sk-ant-raw-key');   // resolved at plan time
    expect(plan[0].callOptions?.reasoning).toBe('low');
  });

  it('keeps chain order (primary first, fallbacks after)', async () => {
    await setLlmConfig({
      providers: [
        { name: 'a', provider: 'anthropic', apiKey: 'k-a' },
        { name: 'o', provider: 'openai', apiKey: 'k-o' },
      ],
      assignments: {
        analyst: { chain: [
          { providerName: 'a', model: 'claude-sonnet-4-6' },
          { providerName: 'o', model: 'gpt-4.1' },
        ] },
      },
    });
    const plan = await resolveLlmPlan('org', 'analyst');
    expect(plan.map(s => (s.model as { provider: string }).provider)).toEqual(['anthropic', 'openai']);
  });

  it('a use case without an assignment routes to the minusx provider when configured', async () => {
    await setLlmConfig({
      providers: [{ name: 'mx', provider: 'minusx', apiKey: 'mx-key' }],
    });
    const plan = await resolveLlmPlan('org', 'micro');
    expect(plan).toHaveLength(1);
    const model = plan[0].model as { provider: string; baseUrl: string };
    expect(model.provider).toBe('minusx');
    expect(model.baseUrl).toBeTruthy();
    expect(plan[0].callOptions?.apiKey).toBe('mx-key');
    expect((plan[0].callOptions?.headers as Record<string, string>)[MX_USE_CASE_HEADER]).toBe('micro');
  });

  it('a use case without an assignment and no minusx provider returns []', async () => {
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      assignments: { analyst: { chain: [{ providerName: 'a', model: 'claude-sonnet-4-6' }] } },
    });
    expect(await resolveLlmPlan('org', 'micro')).toEqual([]);
  });

  it('throws a clear error for an assignment referencing an unknown provider', async () => {
    await setLlmConfig({
      providers: [],
      assignments: { analyst: { chain: [{ providerName: 'ghost', model: 'x' }] } },
    });
    await expect(resolveLlmPlan('org', 'analyst')).rejects.toThrow(/unknown provider 'ghost'/);
  });
});

describe('buildPlanStep — provider mapping', () => {
  it('amazon-bedrock: region + bearer-token auth (not apiKey)', () => {
    const step = buildPlanStep(
      { name: 'bd', provider: 'amazon-bedrock', apiKey: 'bedrock-api-key', awsRegion: 'us-east-1' },
      { providerName: 'bd', model: 'amazon.nova-pro-v1:0' },
      'analyst',
    );
    expect(step.callOptions?.bearerToken).toBe('bedrock-api-key');
    expect(step.callOptions?.apiKey).toBeUndefined();
    expect(step.callOptions?.region).toBe('us-east-1');
  });

  it('custom: builds a custom endpoint model from baseUrl + model id', () => {
    const step = buildPlanStep(
      { name: 'ollama', provider: 'custom', baseUrl: 'http://localhost:11434/v1' },
      { providerName: 'ollama', model: 'qwen3:32b', customModel: { contextWindow: 32000 } },
      'analyst',
    );
    const model = step.model as { id: string; baseUrl: string; contextWindow: number };
    expect(model.id).toBe('qwen3:32b');
    expect(model.baseUrl).toBe('http://localhost:11434/v1');
    expect(model.contextWindow).toBe(32000);
  });

  it('custom without baseUrl or model throws', () => {
    expect(() => buildPlanStep(
      { name: 'c', provider: 'custom' }, { providerName: 'c', model: 'm' }, 'analyst',
    )).toThrow(/baseUrl/);
    expect(() => buildPlanStep(
      { name: 'c', provider: 'custom', baseUrl: 'http://x/v1' }, { providerName: 'c' }, 'analyst',
    )).toThrow(/model id/);
  });

  it('registry provider with unknown model throws the registry error', () => {
    expect(() => buildPlanStep(
      { name: 'a', provider: 'anthropic' }, { providerName: 'a', model: 'not-a-real-model' }, 'analyst',
    )).toThrow(/not in the model registry/);
  });
});
