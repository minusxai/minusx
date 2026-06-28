import { getModel } from '@/orchestrator/llm';
import type { Api, Model } from '@/orchestrator/llm';
import { E2E_MODE } from '@/lib/constants';

/**
 * Shape of `MICRO_AGENT_MODEL_CONFIG` env JSON. Mirrors the analyst config
 * (`agents/analyst/model-config.ts`) but scopes micro-tasks to their own model
 * so low-stakes single-turn helpers (titles/descriptions/summaries/…) don't
 * piggyback on the heavier analyst model.
 *
 *   - `provider` + `model`: model identity, passed to `getModel`.
 *   - `options`: call-time stream options (e.g. `reasoning`), spread blindly
 *     into the orchestrator's `streamSimple`/`callLLM`.
 *
 * Example:
 *   { "provider": "anthropic", "model": "claude-haiku-4-5-20251001" }
 */
export interface MicroModelConfig {
  provider: string;
  model: string;
  options?: Record<string, unknown>;
}

/**
 * Production fallback when `MICRO_AGENT_MODEL_CONFIG` is unset. Micro-tasks are
 * low-stakes, single-turn text generation, so the default is a small/fast model
 * (the same Haiku the Explore agent uses) with no reasoning budget — snappy and
 * cheap. Override via the env var for a different model.
 *
 * Test environments do NOT apply this default — see `getMicroModelConfig`.
 */
const DEFAULT_MICRO_MODEL_CONFIG: MicroModelConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
};

function isTestEnv(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- intentional test-env detection so faux providers stay unreachable in production
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

/**
 * Effective micro model config:
 *   - parsed `MICRO_AGENT_MODEL_CONFIG` if set;
 *   - otherwise `DEFAULT_MICRO_MODEL_CONFIG` in production;
 *   - otherwise `null` (test environments only — lets MicroAgent use its faux
 *     registration via {@link getMicroModelOrTestFallback}).
 */
export function getMicroModelConfig(): MicroModelConfig | null {
  // E2E builds force every agent onto its faux provider (via /api/test/faux).
  if (E2E_MODE) return null;
  // eslint-disable-next-line no-restricted-syntax -- micro model config is intentionally standalone; reads its own scoped env var directly
  const raw = process.env.MICRO_AGENT_MODEL_CONFIG;
  if (raw) return JSON.parse(raw) as MicroModelConfig;
  if (isTestEnv()) return null;
  return DEFAULT_MICRO_MODEL_CONFIG;
}

/** Typed Model from the effective config, or `null` in test envs with no env set. */
export function getMicroModel(): Model<Api> | null {
  const cfg = getMicroModelConfig();
  if (!cfg) return null;
  return getModel(cfg.provider, cfg.model);
}

/**
 * Resolves MicroAgent's model, given its faux test model as the test-only
 * fallback. In production this returns the real configured model (env or the
 * built-in default); the faux fallback is reachable only under a test
 * environment. Throws loudly rather than silently mocking the LLM in production.
 */
export function getMicroModelOrTestFallback(testFallback: Model<Api>): Model<Api> {
  const model = getMicroModel();
  if (model) return model;
  if (!isTestEnv() && !E2E_MODE) {
    throw new Error(
      'MicroAgent model unavailable: MICRO_AGENT_MODEL_CONFIG is unset and no ' +
      'production default could be resolved. Refusing to silently fall back to ' +
      'the test faux provider in production.',
    );
  }
  return testFallback;
}

/** Call-time stream options blob (or undefined). Spread into the agent's callOptions. */
export function getMicroModelOptions(): Record<string, unknown> | undefined {
  return getMicroModelConfig()?.options;
}
