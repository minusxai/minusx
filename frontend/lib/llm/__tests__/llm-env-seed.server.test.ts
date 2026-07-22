// Env → in-app LLM config seeding: ANALYST_AGENT_MODEL_CONFIG /
// MICRO_AGENT_MODEL_CONFIG are an INTERNAL deployment mechanism (undocumented,
// self-contained JSON with the key inline) converted once into the DB config
// (keys → secrets store) and never consulted again; user-owned config is
// never overwritten, and test envs never seed.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { getRawConfig, saveRawConfig } from '@/lib/data/configs.server';
import { isSecretRef } from '@/lib/secrets/config-secret-specs';
import { buildSeedLlmConfig, seedLlmConfigFromEnv } from '../llm-env-seed.server';
import type { LlmConfig } from '../llm-config-types';

describe('buildSeedLlmConfig', () => {
  it('returns null when neither seed var is set', () => {
    expect(buildSeedLlmConfig({})).toBeNull();
  });

  it('converts registry-shaped analyst+micro configs (key inline; providers named by type)', () => {
    const seed = buildSeedLlmConfig({
      ANALYST_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-inline', options: { reasoning: 'low' } }),
      MICRO_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-oa-inline' }),
    })!;
    expect(seed.providers).toHaveLength(2);
    expect(seed.providers![0]).toMatchObject({ name: 'anthropic', provider: 'anthropic', apiKey: 'sk-ant-inline' });
    expect(seed.providers![1]).toMatchObject({ name: 'openai', provider: 'openai', apiKey: 'sk-oa-inline' });
    // analyst → core AND advanced; micro → lite — every grade is mapped after a
    // seed, so an env-provisioned workspace can never hit the unmapped-grade error.
    expect(seed.grades!.core).toMatchObject({ providerName: 'anthropic', model: 'claude-sonnet-4-6', options: { reasoning: 'low' } });
    expect(seed.grades!.advanced).toMatchObject({ providerName: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(seed.grades!.lite).toMatchObject({ providerName: 'openai', model: 'gpt-4.1-mini' });
  });

  it('dedupes to ONE provider when both configs share the same provider + key', () => {
    const seed = buildSeedLlmConfig({
      ANALYST_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-shared', options: { reasoning: 'low' } }),
      MICRO_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: 'sk-shared' }),
    })!;
    expect(seed.providers).toHaveLength(1);
    expect(seed.providers![0]).toMatchObject({ name: 'anthropic', provider: 'anthropic', apiKey: 'sk-shared' });
    expect(seed.grades!.core).toMatchObject({ providerName: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(seed.grades!.lite).toMatchObject({ providerName: 'anthropic', model: 'claude-haiku-4-5-20251001' });
  });

  it('same provider type with DIFFERENT keys stays two entries, auto-suffixed like the UI', () => {
    const seed = buildSeedLlmConfig({
      ANALYST_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-a' }),
      MICRO_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: 'sk-b' }),
    })!;
    expect(seed.providers).toHaveLength(2);
    expect(seed.providers![0].name).toBe('anthropic');
    expect(seed.providers![1].name).toBe('anthropic-2');
    expect(seed.grades!.core!.providerName).toBe('anthropic');
    expect(seed.grades!.lite!.providerName).toBe('anthropic-2');
  });

  it('converts a customModel config (inline key; model overrides preserved)', () => {
    const seed = buildSeedLlmConfig({
      ANALYST_AGENT_MODEL_CONFIG: JSON.stringify({
        customModel: { baseUrl: 'http://vllm:8000/v1', id: 'llama-3.3-70b', apiKey: 'sk-vllm', contextWindow: 32768 },
        options: { temperature: 0 },
      }),
    })!;
    expect(seed.providers![0]).toMatchObject({ name: 'custom', provider: 'custom', baseUrl: 'http://vllm:8000/v1', apiKey: 'sk-vllm' });
    expect(seed.grades!.core).toMatchObject({
      model: 'llama-3.3-70b', options: { temperature: 0 }, customModel: { contextWindow: 32768 },
    });
    // A lone analyst config covers every grade.
    expect(seed.grades!.lite!.model).toBe('llama-3.3-70b');
    expect(seed.grades!.advanced!.model).toBe('llama-3.3-70b');
  });

  it('bedrock config carries key + region inline', () => {
    const seed = buildSeedLlmConfig({
      ANALYST_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'amazon-bedrock', model: 'anthropic.claude-sonnet-4-6', apiKey: 'bedrock-key', awsRegion: 'eu-west-1' }),
    })!;
    expect(seed.providers![0]).toMatchObject({ provider: 'amazon-bedrock', apiKey: 'bedrock-key', awsRegion: 'eu-west-1' });
  });

  it('malformed or incomplete JSON yields no seed', () => {
    expect(buildSeedLlmConfig({ ANALYST_AGENT_MODEL_CONFIG: '{not json' })).toBeNull();
    expect(buildSeedLlmConfig({ ANALYST_AGENT_MODEL_CONFIG: JSON.stringify({ provider: 'anthropic' }) })).toBeNull();
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
    vi.stubEnv('ANALYST_AGENT_MODEL_CONFIG', JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-seeded' }));
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanupTestDatabase(dbPath);
  });

  it('no-ops in test envs so env vars can never seed test workspaces', async () => {
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
