/**
 * Env → in-app LLM config SEEDING (server-only).
 *
 * `ANALYST_AGENT_MODEL_CONFIG` / `MICRO_AGENT_MODEL_CONFIG` are INITIAL
 * CONFIGURATION, not a runtime tier: at boot and at workspace registration,
 * when the org config has no `llm` section yet, they are converted into the
 * in-app config (keys extracted into the secrets store as `@SECRETS/…` refs).
 * From then on the app runs exclusively on the DB config — users see and edit
 * the seeded providers in Settings → Models, and their edits are never
 * overwritten by env (a present `llm` section, even an empty one, means
 * "configured" and the seed is a no-op).
 *
 * INTERNAL deployment mechanism — deliberately undocumented, slated for
 * removal once deploys provision workspaces another way. The JSON is
 * self-contained (the key travels INSIDE it, no cross-env-var indirection):
 *   { "provider": "anthropic", "model": "...", "apiKey": "sk-...",
 *     "awsRegion"?: "...", "options"?: {...} }
 *   { "customModel": { "baseUrl": "...", "id": "...", "apiKey"?: "...", ... },
 *     "options"?: {...} }
 */
import 'server-only';
import { getRawConfig, saveRawConfig } from '@/lib/data/configs.server';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { E2E_MODE } from '@/lib/constants';
import type { LlmConfig, LlmModelChoice, LlmProviderEntry } from './llm-config-types';

interface SeedModelConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  awsRegion?: string;
  options?: Record<string, unknown>;
  customModel?: {
    baseUrl?: string;
    id?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
}

type Env = Record<string, string | undefined>;

function parseSeed(raw: string | undefined): SeedModelConfig | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as SeedModelConfig;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    console.warn('[llm-env-seed] Ignoring malformed model-config env JSON');
    return null;
  }
}

/** One seed config → a provider entry + model choice, or null if unusable. */
function toSeedPiece(cfg: SeedModelConfig, name: string): { entry: LlmProviderEntry; choice: LlmModelChoice } | null {
  if (cfg.customModel?.baseUrl && cfg.customModel.id) {
    const { baseUrl, id, apiKey, headers, ...modelOverrides } = cfg.customModel;
    return {
      entry: {
        name,
        provider: 'custom',
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
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
    return {
      entry: {
        name,
        provider: cfg.provider,
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        ...(cfg.awsRegion ? { awsRegion: cfg.awsRegion } : {}),
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
  const analyst = toSeedPiece(parseSeed(env['ANALYST_AGENT_MODEL_CONFIG']) ?? {}, 'env-analyst');
  const micro = toSeedPiece(parseSeed(env['MICRO_AGENT_MODEL_CONFIG']) ?? {}, 'env-micro');
  if (!analyst && !micro) return null;

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
