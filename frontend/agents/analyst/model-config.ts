import { getModel, type Api, type Model } from '@/lib/llm/get-model';

/**
 * Shape of `ANALYST_AGENT_MODEL_CONFIG` env JSON.
 *
 * Mirrors pi-ai's two-layer separation:
 *   - `provider` + `model`: model identity, passed to pi-ai's `getModel`.
 *   - `options`: call-time `SimpleStreamOptions` (e.g. `reasoning`,
 *     `thinkingBudgets`, `metadata`, `maxRetryDelayMs`). The orchestrator
 *     spreads this **blindly** into pi-ai's `streamSimple`/`callLLM` so
 *     adding a new pi-ai option requires zero code change here — just edit
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
 * Returns the parsed analyst model config (or null if unset).
 *
 * The API key is read by pi-ai from the provider-specific env var
 * (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY) at call time — not part of this config.
 */
export function getAnalystModelConfig(): AnalystModelConfig | null {
  // eslint-disable-next-line no-restricted-syntax -- analyst-agent module is intentionally standalone; reads its own scoped env var directly
  const raw = process.env.ANALYST_AGENT_MODEL_CONFIG;
  if (!raw) return null;
  return JSON.parse(raw) as AnalystModelConfig;
}

/** Returns a typed pi-ai Model from `ANALYST_AGENT_MODEL_CONFIG`, or null. */
export function getAnalystModel(): Model<Api> | null {
  const cfg = getAnalystModelConfig();
  if (!cfg) return null;
  return getModel(cfg.provider, cfg.model);
}

/**
 * Returns the call-time options blob (or undefined). Spread directly into
 * pi-ai's stream options at call sites — no per-key knowledge needed.
 */
export function getAnalystModelOptions(): Record<string, unknown> | undefined {
  return getAnalystModelConfig()?.options;
}
