import { getModel, type Api, type Model } from '@mariozechner/pi-ai';

/**
 * Reads ANALYST_AGENT_MODEL_CONFIG (JSON `{provider, model}`) from env and
 * returns a typed pi-ai Model. Returns null if unset so callers can fall back
 * to the faux model (default for unit tests).
 *
 * The API key is read by pi-ai from the provider-specific env var
 * (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY) at call time — not part of this config.
 */
export function getAnalystModel(): Model<Api> | null {
  // eslint-disable-next-line no-restricted-syntax -- analyst-agent module is intentionally standalone; reads its own scoped env var directly
  const raw = process.env.ANALYST_AGENT_MODEL_CONFIG;
  if (!raw) return null;
  const cfg = JSON.parse(raw) as { provider: string; model: string };
  return getModel(cfg.provider as never, cfg.model as never);
}
