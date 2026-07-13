// Env → in-app LLM config seeding: the legacy env vars are INITIAL
// configuration, converted once into the DB config (keys → secrets store)
// and never consulted again; user-owned config is never overwritten.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { getRawConfig, saveRawConfig } from '@/lib/data/configs.server';
import { isSecretRef } from '@/lib/secrets/config-secret-specs';
import { buildSeedLlmConfig, seedLlmConfigFromEnv } from '../llm-env-seed.server';
import type { LlmConfig } from '../llm-config-types';

describe('buildSeedLlmConfig', () => {
  it('returns null when nothing is configured', () => {
    expect(buildSeedLlmConfig({})).toBeNull();
  });

  it('converts registry-shaped analyst+micro configs with keys from the standard env vars', () => {
    const seed = buildSeedLlmConfig({
      ANALYST_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4-6', options: { reasoning: 'low' } }),
      MICRO_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'openai', model: 'gpt-4.1-mini' }),
      ANTHROPIC_API_KEY: 'sk-ant-env',
      OPENAI_API_KEY: 'sk-oa-env',
    })!;
    expect(seed.providers).toHaveLength(2);
    expect(seed.providers![0]).toMatchObject({ name: 'env-analyst', provider: 'anthropic', apiKey: 'sk-ant-env' });
    expect(seed.providers![1]).toMatchObject({ name: 'env-micro', provider: 'openai', apiKey: 'sk-oa-env' });
    expect(seed.assignments!.analyst!.chain[0]).toMatchObject({ providerName: 'env-analyst', model: 'claude-sonnet-4-6', options: { reasoning: 'low' } });
    expect(seed.assignments!.micro!.chain[0]).toMatchObject({ providerName: 'env-micro', model: 'gpt-4.1-mini' });
  });

  it('converts a customModel config (endpoint key via apiKeyEnv; overrides preserved)', () => {
    const seed = buildSeedLlmConfig({
      ANALYST_AGENT_MODEL_CONFIG: JSON.stringify({
        customModel: { baseUrl: 'http://vllm:8000/v1', id: 'llama-3.3-70b', apiKeyEnv: 'VLLM_KEY', contextWindow: 32768 },
        options: { temperature: 0 },
      }),
      VLLM_KEY: 'sk-vllm',
    })!;
    expect(seed.providers![0]).toMatchObject({ name: 'env-analyst', provider: 'custom', baseUrl: 'http://vllm:8000/v1', apiKey: 'sk-vllm' });
    expect(seed.assignments!.analyst!.chain[0]).toMatchObject({
      model: 'llama-3.3-70b', options: { temperature: 0 }, customModel: { contextWindow: 32768 },
    });
    // A lone analyst config covers micro too.
    expect(seed.assignments!.micro!.chain[0].model).toBe('llama-3.3-70b');
  });

  it('a bare ANTHROPIC_API_KEY seeds the historical defaults (sonnet analyst, haiku micro)', () => {
    const seed = buildSeedLlmConfig({ ANTHROPIC_API_KEY: 'sk-ant-simple' })!;
    expect(seed.providers![0]).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant-simple' });
    expect(seed.assignments!.analyst!.chain[0].model).toBe('claude-sonnet-4-6');
    expect(seed.assignments!.micro!.chain[0].model).toBe('claude-haiku-4-5-20251001');
  });

  it('bedrock config picks up the bearer token and region', () => {
    const seed = buildSeedLlmConfig({
      ANALYST_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'amazon-bedrock', model: 'anthropic.claude-sonnet-4-6' }),
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key',
      AWS_REGION: 'eu-west-1',
    })!;
    expect(seed.providers![0]).toMatchObject({ provider: 'amazon-bedrock', apiKey: 'bedrock-key', awsRegion: 'eu-west-1' });
  });

  it('tolerates malformed JSON (falls through to the simple form)', () => {
    const seed = buildSeedLlmConfig({ ANALYST_AGENT_MODEL_CONFIG: '{not json', ANTHROPIC_API_KEY: 'k' });
    expect(seed!.providers![0].provider).toBe('anthropic');
  });
});

describe('seedLlmConfigFromEnv (DB)', () => {
  const dbPath = getTestDbPath('llm_env_seed');
  beforeAll(async () => {
    await initTestDatabase(dbPath);
    // The seed is guarded against test envs (faux-model invariant) — simulate
    // a production boot for these assertions.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-seeded');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanupTestDatabase(dbPath);
  });

  it('no-ops in test envs so a dev shell key can never seed test workspaces', async () => {
    vi.stubEnv('VITEST', 'true');
    expect(await seedLlmConfigFromEnv()).toBe(false);
    vi.stubEnv('VITEST', '');
  });

  it('seeds once (key extracted to a secrets ref), then no-ops; user config is never overwritten', async () => {
    expect(await seedLlmConfigFromEnv()).toBe(true);
    const llm = (await getRawConfig('org')).llm as LlmConfig;
    expect(isSecretRef(llm.providers![0].apiKey)).toBe(true);   // extracted, not raw
    expect(JSON.stringify(llm)).not.toContain('sk-ant-seeded');

    // Second boot: llm section exists → no-op.
    expect(await seedLlmConfigFromEnv()).toBe(false);

    // User clears the config (llm: {} present) — still owned by the user, never re-seeded.
    const raw = await getRawConfig('org');
    await saveRawConfig('org', { ...raw, llm: {} } as never);
    expect(await seedLlmConfigFromEnv()).toBe(false);
    expect((await getRawConfig('org')).llm).toEqual({});
  });
});
