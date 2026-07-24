// DB-backed plan resolution: reads the org config's `llm` section, resolves
// @SECRETS refs to raw keys, and maps agent → grade → (provider, model,
// options) onto an executable plan step (registry / bedrock / custom /
// minusx). One model per grade; an unmapped grade with no minusx provider is
// a hard, clearly-worded error.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { saveRawConfig, getRawConfig } from '@/lib/data/configs.server';
import { isSecretRef } from '@/lib/secrets/config-secret-specs';
import compatibility from '@/compatibility.json';
import { resolveLlmPlan, buildPlanStep } from '../llm-plan.server';
import { MX_USE_CASE_HEADER, type LlmConfig } from '../llm-config-types';
import { MINUSX_AUTO_MODEL, MINUSX_UNCONFIGURED_KEY } from '../minusx-default';

const dbPath = getTestDbPath('llm_plan_server');
beforeAll(async () => { await initTestDatabase(dbPath); });
afterAll(async () => { await cleanupTestDatabase(dbPath); });

async function setLlmConfig(llm: unknown) {
  const raw = await getRawConfig('org');
  await saveRawConfig('org', { ...raw, llm } as never);
}

describe('resolveLlmPlan', () => {
  it('returns null for an unconfigured workspace in TEST envs (agents keep faux models)', async () => {
    await setLlmConfig(undefined);
    expect(await resolveLlmPlan({ agent: 'analyst' })).toBeNull();
  });

  it('defaults an unconfigured workspace to the MinusX gateway in production, with the grade in the routing header', async () => {
    await setLlmConfig(undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    try {
      // micro's default grade is lite; analyst's is core.
      const microPlan = (await resolveLlmPlan({ agent: 'micro' }))!;
      const model = microPlan.model as { provider: string; id: string };
      expect(model.provider).toBe('minusx');
      expect(model.id).toBe(MINUSX_AUTO_MODEL);
      expect((microPlan.callOptions?.headers as Record<string, string>)[MX_USE_CASE_HEADER]).toBe('lite');
      // Deterministic sentinel key — the request reaches the gateway (whose
      // auth policy answers), instead of dying client-side env-dependently.
      expect(microPlan.callOptions?.apiKey).toBe(MINUSX_UNCONFIGURED_KEY);

      const analystPlan = (await resolveLlmPlan({ agent: 'analyst' }))!;
      expect((analystPlan.callOptions?.headers as Record<string, string>)[MX_USE_CASE_HEADER]).toBe('core');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('routes each agent through its default grade (analyst → core, micro → lite)', async () => {
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      grades: {
        lite: { providerName: 'a', model: 'claude-haiku-4-5' },
        core: { providerName: 'a', model: 'claude-sonnet-4-6' },
      },
    } satisfies LlmConfig);
    expect(((await resolveLlmPlan({ agent: 'analyst' }))!.model as { id: string }).id).toBe('claude-sonnet-4-6');
    expect(((await resolveLlmPlan({ agent: 'micro' }))!.model as { id: string }).id).toBe('claude-haiku-4-5');
    // report/slack/web-analyst ride the same built-in core default.
    expect(((await resolveLlmPlan({ agent: 'report' }))!.model as { id: string }).id).toBe('claude-sonnet-4-6');
  });

  it('honors a config agent-policy override for the default grade', async () => {
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      grades: {
        core: { providerName: 'a', model: 'claude-sonnet-4-6' },
        advanced: { providerName: 'a', model: 'claude-opus-4-8' },
      },
      agents: { slack: { defaultGrade: 'advanced' } },
    } satisfies LlmConfig);
    expect(((await resolveLlmPlan({ agent: 'slack' }))!.model as { id: string }).id).toBe('claude-opus-4-8');
  });

  it('a code-owned selector grade (micro-task override) bypasses the agent allowlist', async () => {
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      grades: {
        lite: { providerName: 'a', model: 'claude-haiku-4-5' },
        core: { providerName: 'a', model: 'claude-sonnet-4-6' },
      },
    } satisfies LlmConfig);
    // micro's policy allows only lite, but the task-declared grade is code-owned.
    const plan = (await resolveLlmPlan({ agent: 'micro', grade: 'core' }))!;
    expect((plan.model as { id: string }).id).toBe('claude-sonnet-4-6');
  });

  // Connecting ONE provider must power every grade — the settings page implies
  // it, and the env-seed path has always guaranteed it. Without this, saving a
  // provider and nothing else bricks every chat with an unmapped-grade error.
  it('auto-resolves an unmapped grade to the workspace\'s sole BYOK provider (compat default for that grade)', async () => {
    const anthropicDefaults = (compatibility.llm.providers as { id: string; defaults?: Record<string, string> }[])
      .find(p => p.id === 'anthropic')!.defaults!;
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      grades: { core: { providerName: 'a', model: 'claude-sonnet-4-6' } },
    } satisfies LlmConfig);
    // lite is unmapped; micro rides it and must still resolve.
    expect(((await resolveLlmPlan({ agent: 'micro' }))!.model as { id: string }).id).toBe(anthropicDefaults['lite']);
    // The explicit mapping still wins for the grade that has one.
    expect(((await resolveLlmPlan({ agent: 'analyst' }))!.model as { id: string }).id).toBe('claude-sonnet-4-6');
  });

  it('auto-resolves EVERY grade when a lone provider is saved with no grade mappings at all', async () => {
    const anthropicDefaults = (compatibility.llm.providers as { id: string; defaults?: Record<string, string> }[])
      .find(p => p.id === 'anthropic')!.defaults!;
    // Exactly what Settings → Models writes after "add provider + key + save".
    await setLlmConfig({ providers: [{ name: 'anthropic', provider: 'anthropic', apiKey: 'k' }] } satisfies LlmConfig);
    expect(((await resolveLlmPlan({ agent: 'web-analyst' }))!.model as { id: string }).id).toBe(anthropicDefaults['core']);
    expect(((await resolveLlmPlan({ agent: 'micro' }))!.model as { id: string }).id).toBe(anthropicDefaults['lite']);
    expect(((await resolveLlmPlan({ agent: 'analyst' }, 'advanced'))!.model as { id: string }).id)
      .toBe(anthropicDefaults['advanced']);
  });

  it('still throws for an unmapped grade when TWO BYOK providers make the pick ambiguous', async () => {
    await setLlmConfig({
      providers: [
        { name: 'a', provider: 'anthropic', apiKey: 'k' },
        { name: 'o', provider: 'openai', apiKey: 'k2' },
      ],
      grades: { core: { providerName: 'a', model: 'claude-sonnet-4-6' } },
    } satisfies LlmConfig);
    await expect(resolveLlmPlan({ agent: 'micro' })).rejects.toThrow(
      /No model is mapped to grade 'lite' \(agent 'micro'\)\. Map it in Settings → Models\./,
    );
  });

  it('still throws for a lone provider with no compatibility curation (a model id cannot be guessed)', async () => {
    await setLlmConfig({
      providers: [{ name: 'local', provider: 'custom', baseUrl: 'http://localhost:11434/v1' }],
    } satisfies LlmConfig);
    await expect(resolveLlmPlan({ agent: 'analyst' })).rejects.toThrow(
      /No model is mapped to grade 'core' \(agent 'analyst'\)\. Map it in Settings → Models\./,
    );
  });

  // Deleting the last provider in Settings → Models saves `llm: {}`. That must
  // not be a dead end: the page cannot remove the section, so treating an empty
  // section as "configured" leaves the workspace unrecoverable from the UI.
  it('treats an `llm` section with no endpoints as unconfigured (managed default, not a hard error)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    try {
      await setLlmConfig({} satisfies LlmConfig);
      expect(((await resolveLlmPlan({ agent: 'analyst' }))!.model as { provider: string }).provider).toBe('minusx');
      // An agent-policy-only section is likewise not an endpoint configuration.
      await setLlmConfig({ agents: { slack: { defaultGrade: 'advanced' } } } satisfies LlmConfig);
      expect(((await resolveLlmPlan({ agent: 'slack' }))!.model as { provider: string }).provider).toBe('minusx');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('an unmapped grade routes to the minusx provider when configured, grade in the header', async () => {
    await setLlmConfig({
      providers: [{ name: 'mx', provider: 'minusx', apiKey: 'mx-key' }],
    } satisfies LlmConfig);
    const plan = (await resolveLlmPlan({ agent: 'micro' }))!;
    const model = plan.model as { provider: string; baseUrl: string };
    expect(model.provider).toBe('minusx');
    expect(model.baseUrl).toBeTruthy();
    expect(plan.callOptions?.apiKey).toBe('mx-key');
    expect((plan.callOptions?.headers as Record<string, string>)[MX_USE_CASE_HEADER]).toBe('lite');
  });

  it('an explicit grade mapping beats the minusx catch-all for that grade only', async () => {
    await setLlmConfig({
      providers: [
        { name: 'mx', provider: 'minusx', apiKey: 'mx-key' },
        { name: 'a', provider: 'anthropic', apiKey: 'k' },
      ],
      grades: { advanced: { providerName: 'a', model: 'claude-opus-4-8' } },
    } satisfies LlmConfig);
    const advancedPlan = (await resolveLlmPlan({ agent: 'analyst' }, 'advanced'))!;
    expect((advancedPlan.model as { provider: string }).provider).toBe('anthropic');
    const corePlan = (await resolveLlmPlan({ agent: 'analyst' }))!;
    expect((corePlan.model as { provider: string }).provider).toBe('minusx');
    expect((corePlan.callOptions?.headers as Record<string, string>)[MX_USE_CASE_HEADER]).toBe('core');
  });

  it('resolves a model-less registry mapping (Auto) to the compatibility default per grade', async () => {
    // Expected ids come from compatibility.json itself (curation edits move
    // with the data; the contract test guards the data's validity).
    const anthropicDefaults = (compatibility.llm.providers as { id: string; defaults?: Record<string, string> }[])
      .find(p => p.id === 'anthropic')!.defaults!;
    await setLlmConfig({
      providers: [{ name: 'main-anthropic', provider: 'anthropic', apiKey: 'sk-ant-raw-key' }],
      grades: {
        lite: { providerName: 'main-anthropic' },
        core: { providerName: 'main-anthropic' },
      },
    } satisfies LlmConfig);
    expect(((await resolveLlmPlan({ agent: 'analyst' }))!.model as { id: string }).id).toBe(anthropicDefaults['core']);
    expect(((await resolveLlmPlan({ agent: 'micro' }))!.model as { id: string }).id).toBe(anthropicDefaults['lite']);
  });

  it('still requires a model id for registry providers without compatibility defaults', () => {
    expect(() => buildPlanStep({ name: 'm', provider: 'mistral' }, { providerName: 'm' }, 'core'))
      .toThrow(/model id/);
  });

  it('ignores a stale model on a minusx grade mapping — always sends the minusx-auto sentinel', () => {
    // Repro of the Settings → Models bug: switching a grade's provider to MinusX
    // left the previous provider's model id on the choice. The gateway routes by
    // grade, so any stored model is meaningless and must never reach it (a real
    // model id like this would 400 the gateway). See llm-config-types: the model
    // is documented as "ignored for minusx".
    const step = buildPlanStep(
      { name: 'mx', provider: 'minusx', apiKey: 'mx-key' },
      { providerName: 'mx', model: 'gpt-5.6-terra' },
      'core',
    );
    expect((step.model as { provider: string; id: string }).provider).toBe('minusx');
    expect((step.model as { id: string }).id).toBe(MINUSX_AUTO_MODEL);
  });

  it('resolves a grade mapping with secret-resolved API keys and options passthrough', async () => {
    await setLlmConfig({
      providers: [{ name: 'main-anthropic', provider: 'anthropic', apiKey: 'sk-ant-raw-key' }],
      grades: {
        core: { providerName: 'main-anthropic', model: 'claude-sonnet-4-6', options: { reasoning: 'low' } },
      },
    } satisfies LlmConfig);

    // The stored doc holds a ref, not the raw key (extraction ran on save).
    const stored = (await getRawConfig('org')).llm as LlmConfig;
    expect(isSecretRef(stored.providers![0].apiKey)).toBe(true);

    const plan = (await resolveLlmPlan({ agent: 'analyst' }))!;
    expect((plan.model as { id: string }).id).toBe('claude-sonnet-4-6');
    expect(plan.callOptions?.apiKey).toBe('sk-ant-raw-key');   // resolved at plan time
    expect(plan.callOptions?.reasoning).toBe('low');
  });

  it('throws a clear error for a grade mapping referencing an unknown provider', async () => {
    await setLlmConfig({
      providers: [],
      grades: { core: { providerName: 'ghost', model: 'x' } },
    } satisfies LlmConfig);
    await expect(resolveLlmPlan({ agent: 'analyst' })).rejects.toThrow(/unknown provider 'ghost'/);
  });

  it('uses an allowed per-chat grade override without changing the configured default', async () => {
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      grades: {
        core: { providerName: 'a', model: 'claude-sonnet-4-6' },
        advanced: { providerName: 'a', model: 'claude-opus-4-8' },
      },
    } satisfies LlmConfig);

    const override = await resolveLlmPlan({ agent: 'analyst' }, 'advanced');
    const configured = await resolveLlmPlan({ agent: 'analyst' });

    expect((override!.model as { id: string }).id).toBe('claude-opus-4-8');
    expect((configured!.model as { id: string }).id).toBe('claude-sonnet-4-6');
  });

  it("rejects a per-chat grade outside the agent's allowed grades", async () => {
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      grades: {
        lite: { providerName: 'a', model: 'claude-haiku-4-5' },
        core: { providerName: 'a', model: 'claude-sonnet-4-6' },
      },
      agents: { analyst: { allowedGrades: ['core'] } },
    } satisfies LlmConfig);
    await expect(resolveLlmPlan({ agent: 'analyst' }, 'lite')).rejects.toThrow(
      /Grade 'lite' is not allowed for agent 'analyst'/,
    );
  });

  it('an allowed but unmapped per-chat grade auto-resolves on the sole provider', async () => {
    const anthropicDefaults = (compatibility.llm.providers as { id: string; defaults?: Record<string, string> }[])
      .find(p => p.id === 'anthropic')!.defaults!;
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      grades: { core: { providerName: 'a', model: 'claude-sonnet-4-6' } },
    } satisfies LlmConfig);
    // The picker offers Advanced, so picking it must run — not error.
    expect(((await resolveLlmPlan({ agent: 'analyst' }, 'advanced'))!.model as { id: string }).id)
      .toBe(anthropicDefaults['advanced']);
  });

  it('an allowed but unmapped per-chat grade still errors when the provider pick is ambiguous', async () => {
    await setLlmConfig({
      providers: [
        { name: 'a', provider: 'anthropic', apiKey: 'k' },
        { name: 'o', provider: 'openai', apiKey: 'k2' },
      ],
      grades: { core: { providerName: 'a', model: 'claude-sonnet-4-6' } },
    } satisfies LlmConfig);
    await expect(resolveLlmPlan({ agent: 'analyst' }, 'advanced')).rejects.toThrow(
      /No model is mapped to grade 'advanced' \(agent 'analyst'\)/,
    );
  });

  it('an unknown selector agent rides the analyst policy (benchmark/eval agents)', async () => {
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      grades: { core: { providerName: 'a', model: 'claude-sonnet-4-6' } },
    } satisfies LlmConfig);
    const plan = (await resolveLlmPlan({ agent: 'some-benchmark-agent' }))!;
    expect((plan.model as { id: string }).id).toBe('claude-sonnet-4-6');
  });

  it('a legacy assignments-only config is ignored, not migrated (the provider auto-covers grades)', async () => {
    const anthropicDefaults = (compatibility.llm.providers as { id: string; defaults?: Record<string, string> }[])
      .find(p => p.id === 'anthropic')!.defaults!;
    // Pre-grades shape, stored before the redesign: never read. The provider
    // it names still auto-covers every grade — at the COMPAT default, not the
    // model the legacy assignment pinned.
    await setLlmConfig({
      providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
      assignments: { analyst: { chain: [{ providerName: 'a', model: 'claude-sonnet-4-6' }] } },
    });
    expect(((await resolveLlmPlan({ agent: 'analyst' }))!.model as { id: string }).id).toBe(anthropicDefaults['core']);
  });

  it('uses server-owned metadata for a custom-provider grade mapping', async () => {
    await setLlmConfig({
      providers: [{ name: 'local', provider: 'custom', baseUrl: 'http://localhost:11434/v1' }],
      grades: {
        core: { providerName: 'local', model: 'qwen3:32b', customModel: { contextWindow: 32_000 } },
      },
    } satisfies LlmConfig);
    const plan = await resolveLlmPlan({ agent: 'analyst' });
    expect((plan!.model as { contextWindow: number }).contextWindow).toBe(32_000);
  });
});

describe('buildPlanStep — provider mapping', () => {
  it('amazon-bedrock: region + bearer-token auth (not apiKey)', () => {
    const step = buildPlanStep(
      { name: 'bd', provider: 'amazon-bedrock', apiKey: 'bedrock-api-key', awsRegion: 'us-east-1' },
      { providerName: 'bd', model: 'amazon.nova-pro-v1:0' },
      'core',
    );
    expect(step.callOptions?.bearerToken).toBe('bedrock-api-key');
    expect(step.callOptions?.apiKey).toBeUndefined();
    expect(step.callOptions?.region).toBe('us-east-1');
  });

  it('custom: builds a custom endpoint model from baseUrl + model id', () => {
    const step = buildPlanStep(
      { name: 'ollama', provider: 'custom', baseUrl: 'http://localhost:11434/v1' },
      { providerName: 'ollama', model: 'qwen3:32b', customModel: { contextWindow: 32000 } },
      'core',
    );
    const model = step.model as { id: string; baseUrl: string; contextWindow: number };
    expect(model.id).toBe('qwen3:32b');
    expect(model.baseUrl).toBe('http://localhost:11434/v1');
    expect(model.contextWindow).toBe(32000);
  });

  it('custom without baseUrl or model throws', () => {
    expect(() => buildPlanStep(
      { name: 'c', provider: 'custom' }, { providerName: 'c', model: 'm' }, 'core',
    )).toThrow(/baseUrl/);
    expect(() => buildPlanStep(
      { name: 'c', provider: 'custom', baseUrl: 'http://x/v1' }, { providerName: 'c' }, 'core',
    )).toThrow(/model id/);
  });

  it('registry provider with unknown model throws the registry error', () => {
    expect(() => buildPlanStep(
      { name: 'a', provider: 'anthropic' }, { providerName: 'a', model: 'not-a-real-model' }, 'core',
    )).toThrow(/not in the model registry/);
  });
});
