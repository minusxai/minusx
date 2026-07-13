/**
 * Env → in-app LLM config SEEDING (server-only).
 *
 * `ANALYST_AGENT_MODEL_CONFIG` / `MICRO_AGENT_MODEL_CONFIG` (and the simple
 * `ANTHROPIC_API_KEY` form) are INITIAL CONFIGURATION, not a runtime tier: at
 * boot and at workspace registration, when the org config has no `llm` section
 * yet, they are converted into the in-app config (keys extracted into the
 * secrets store as `@SECRETS/…` refs). From then on the app runs exclusively
 * on the DB config — users see and edit the seeded providers in Settings →
 * Models, and their edits are never overwritten by env (a present `llm`
 * section, even an empty one, means "configured" and the seed is a no-op).
 *
 * This is also the lossless upgrade path: existing env-configured deployments
 * boot once and their config materializes in the app.
 *
 * Legacy JSON shapes (both vars): `{ provider, model, options? }` or
 * `{ customModel: { baseUrl, id, apiKeyEnv?, ... }, options? }`.
 */
import 'server-only';
import { getRawConfig, saveRawConfig } from '@/lib/data/configs.server';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { E2E_MODE } from '@/lib/constants';
import type { LlmConfig, LlmModelChoice, LlmProviderEntry } from './llm-config-types';

/** Standard key env var per registry provider slug (mirrors pi-ai's lookup). */
const PROVIDER_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  'amazon-bedrock': 'AWS_BEARER_TOKEN_BEDROCK',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  moonshotai: 'MOONSHOT_API_KEY',
  zai: 'ZAI_API_KEY',
  huggingface: 'HF_TOKEN',
};

interface LegacyModelConfig {
  provider?: string;
  model?: string;
  options?: Record<string, unknown>;
  customModel?: {
    baseUrl?: string;
    id?: string;
    apiKeyEnv?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
}

type Env = Record<string, string | undefined>;

function parseLegacy(raw: string | undefined): LegacyModelConfig | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as LegacyModelConfig;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    console.warn('[llm-env-seed] Ignoring malformed model-config env JSON');
    return null;
  }
}

/** One legacy config → a provider entry + model choice, or null if unusable. */
function toSeedPiece(cfg: LegacyModelConfig, name: string, env: Env): { entry: LlmProviderEntry; choice: LlmModelChoice } | null {
  if (cfg.customModel?.baseUrl && cfg.customModel.id) {
    const { baseUrl, id, apiKeyEnv, headers, ...modelOverrides } = cfg.customModel;
    return {
      entry: {
        name,
        provider: 'custom',
        baseUrl,
        ...(apiKeyEnv && env[apiKeyEnv] ? { apiKey: env[apiKeyEnv] } : {}),
        ...(headers ? { headers } : {}),
      },
      choice: {
        providerName: name,
        model: id,
        ...(cfg.options ? { options: cfg.options } : {}),
        ...(Object.keys(modelOverrides).length > 0 ? { customModel: modelOverrides } : {}),
      },
    };
  }
  if (cfg.provider && cfg.model) {
    const keyEnv = PROVIDER_KEY_ENV[cfg.provider];
    return {
      entry: {
        name,
        provider: cfg.provider,
        ...(keyEnv && env[keyEnv] ? { apiKey: env[keyEnv] } : {}),
        ...(cfg.provider === 'amazon-bedrock' && env['AWS_REGION'] ? { awsRegion: env['AWS_REGION'] } : {}),
      },
      choice: { providerName: name, model: cfg.model, ...(cfg.options ? { options: cfg.options } : {}) },
    };
  }
  return null;
}

/**
 * Build the seed LlmConfig from an env record. Null when there is nothing to
 * seed. Pure — exported for tests.
 */
export function buildSeedLlmConfig(env: Env): LlmConfig | null {
  const analyst = toSeedPiece(parseLegacy(env['ANALYST_AGENT_MODEL_CONFIG']) ?? {}, 'env-analyst', env);
  const micro = toSeedPiece(parseLegacy(env['MICRO_AGENT_MODEL_CONFIG']) ?? {}, 'env-micro', env);

  if (analyst || micro) {
    const providers: LlmProviderEntry[] = [];
    const assignments: LlmConfig['assignments'] = {};
    if (analyst) {
      providers.push(analyst.entry);
      assignments.analyst = { chain: [analyst.choice] };
    }
    if (micro) {
      providers.push(micro.entry);
      assignments.micro = { chain: [micro.choice] };
    }
    // A lone config covers both use cases rather than leaving one unconfigured.
    if (analyst && !micro) assignments.micro = { chain: [analyst.choice] };
    if (micro && !analyst) assignments.analyst = { chain: [micro.choice] };
    return { providers, assignments };
  }

  // Simple form: just an Anthropic key — the historical zero-JSON install path.
  if (env['ANTHROPIC_API_KEY']) {
    const name = 'env-anthropic';
    return {
      providers: [{ name, provider: 'anthropic', apiKey: env['ANTHROPIC_API_KEY'] }],
      assignments: {
        analyst: { chain: [{ providerName: name, model: 'claude-sonnet-4-6', options: { reasoning: 'low' } }] },
        micro: { chain: [{ providerName: name, model: 'claude-haiku-4-5-20251001' }] },
      },
    };
  }

  return null;
}

function isTestEnv(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- faux-model invariant: a dev shell exporting a provider key must not seed real config into test workspaces
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

/**
 * Seed the workspace's in-app LLM config from env — only when no `llm` section
 * exists yet (a present section, even `{}`, is user-owned and never touched).
 * No-op in test envs (a seeded real provider would defeat the faux models).
 * Idempotent and best-effort; returns whether a seed was written.
 */
export async function seedLlmConfigFromEnv(): Promise<boolean> {
  if (isTestEnv() || E2E_MODE) return false;
  const raw = await getRawConfig(DEFAULT_MODE);
  if ('llm' in raw) return false;
  // eslint-disable-next-line no-restricted-syntax -- reads the legacy model-config env vars it exists to convert
  const seed = buildSeedLlmConfig(process.env);
  if (!seed) return false;
  await saveRawConfig(DEFAULT_MODE, { ...raw, llm: seed });
  console.log('[llm-env-seed] Seeded in-app LLM config from environment variables (editable in Settings → Models)');
  return true;
}
