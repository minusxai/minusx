import { getModel } from '@/orchestrator/llm';
import type { Api, Model } from '@/orchestrator/llm';

/**
 * Shape of `ANALYST_AGENT_MODEL_CONFIG` env JSON.
 *
 * Mirrors a two-layer separation:
 *   - `provider` + `model`: model identity, passed to the orchestrator's `getModel`.
 *   - `options`: call-time `SimpleStreamOptions` (e.g. `reasoning`,
 *     `thinkingBudgets`, `metadata`, `maxRetryDelayMs`). The orchestrator
 *     spreads this **blindly** into the orchestrator's `streamSimple`/`callLLM` so
 *     adding a new stream option requires zero code change here — just edit
 *     the env JSON.
 *
 * Example:
 *   { "provider": "anthropic", "model": "claude-opus-4-5",
 *     "options": { "reasoning": "low" } }
 */
export interface AnalystModelConfig {
  provider: string;
  model: string;
  options?: Record<string, unknown>;
}

/**
 * Production fallback used when `ANALYST_AGENT_MODEL_CONFIG` is not set.
 *
 * This default is deliberate: previously, an unset env caused every agent to
 * silently fall back to its faux (test) provider, which then errored at the
 * first LLM call with "No more faux responses queued". A sensible real model
 * is the safer default for any deployment that hasn't configured an LLM yet.
 *
 * Test environments do NOT apply this default — see `getAnalystModelConfig`.
 */
const DEFAULT_ANALYST_MODEL_CONFIG: AnalystModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  options: { reasoning: 'low' },
};

function isTestEnv(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- intentional test-env detection so faux providers stay unreachable in production
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

/**
 * Returns the effective analyst model config:
 *   - parsed `ANALYST_AGENT_MODEL_CONFIG` if set;
 *   - otherwise `DEFAULT_ANALYST_MODEL_CONFIG` in production;
 *   - otherwise `null` (test environments only — lets agents use their
 *     faux registration via {@link getAgentModelOrTestFallback}).
 *
 * The API key is read by the LLM client from the provider-specific env var
 * (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY) at call time — not part of this config.
 */
export function getAnalystModelConfig(): AnalystModelConfig | null {
  // eslint-disable-next-line no-restricted-syntax -- analyst-agent module is intentionally standalone; reads its own scoped env var directly
  const raw = process.env.ANALYST_AGENT_MODEL_CONFIG;
  if (raw) return JSON.parse(raw) as AnalystModelConfig;
  if (isTestEnv()) return null;
  return DEFAULT_ANALYST_MODEL_CONFIG;
}

/**
 * Returns a typed Model from the effective config, or `null` in test
 * environments when no `ANALYST_AGENT_MODEL_CONFIG` is set.
 */
export function getAnalystModel(): Model<Api> | null {
  const cfg = getAnalystModelConfig();
  if (!cfg) return null;
  return getModel(cfg.provider, cfg.model);
}

/**
 * Resolves the model for an agent class, given the agent's faux test model
 * as the **test-only** fallback. In production this is guaranteed to return
 * the real configured model (either from `ANALYST_AGENT_MODEL_CONFIG` or the
 * built-in default). The faux fallback is reachable only when running under
 * a test environment (`NODE_ENV === 'test'` or `VITEST`); if the production
 * code path ever reaches here without a real model, this throws loudly
 * rather than silently mocking the LLM.
 *
 * This is the **only** sanctioned way an agent class should reference its
 * faux model in its static `model` field. The runtime guard inside this
 * function is what makes "no faux models in production" a code-enforced
 * invariant rather than a convention.
 */
export function getAgentModelOrTestFallback(testFallback: Model<Api>): Model<Api> {
  const model = getAnalystModel();
  if (model) return model;
  if (!isTestEnv()) {
    throw new Error(
      'Agent model unavailable: ANALYST_AGENT_MODEL_CONFIG is unset and ' +
      'no production default could be resolved. Refusing to silently fall ' +
      'back to the test faux provider in production.',
    );
  }
  return testFallback;
}

/**
 * Returns the call-time options blob (or undefined). Spread directly into
 * the orchestrator's stream options at call sites — no per-key knowledge needed.
 */
export function getAnalystModelOptions(): Record<string, unknown> | undefined {
  return getAnalystModelConfig()?.options;
}
