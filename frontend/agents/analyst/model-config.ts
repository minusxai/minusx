import { getModel, type Api, type Model } from '@mariozechner/pi-ai';
import { MX_API_BASE_URL, MX_API_KEY } from '@/lib/config';

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
  const base = getModel(cfg.provider as never, cfg.model as never);
  if (!MX_API_BASE_URL) return base;
  // Route through mx-llm-provider's /proxy/* endpoint — it accepts
  // direct Anthropic-style paths and handles logging + auth injection,
  // matching Python's MxProxyTransport behaviour.
  // Shallow-copy so the shared model object is never mutated across requests.
  return {
    ...base,
    baseUrl: `${MX_API_BASE_URL}/proxy`,
    headers: {
      ...((base as unknown as { headers?: Record<string, string> }).headers ?? {}),
      'mx-api-key': MX_API_KEY,
    },
  } as typeof base;
}

/**
 * Returns the call-time options blob (or undefined). Spread directly into
 * pi-ai's stream options at call sites — no per-key knowledge needed.
 */
export function getAnalystModelOptions(): Record<string, unknown> | undefined {
  return getAnalystModelConfig()?.options;
}
