/**
 * The MinusX managed gateway as a model: the DEFAULT for every use case when a
 * workspace has configured nothing else, and the executable form of any
 * configured `minusx` provider entry. Pure (no server-only) — shared by the
 * server plan resolver and the agents' static model fields.
 *
 * The gateway is OpenAI-compatible; it routes model/prompt/fallbacks per use
 * case from the `X-MX-Use-Case` header (`minusx-auto` model sentinel). The
 * workspace's gateway API key lives in the config secrets store and is
 * injected per call by the plan resolver — never on the model handle.
 */
import { buildCustomModel, type Api, type Model } from '@/orchestrator/llm';
import { MINUSX_GATEWAY_URL } from '@/lib/constants';
import { MINUSX_PROVIDER, MX_USE_CASE_HEADER, type LlmUseCase } from './llm-config-types';

/** Model id sentinel telling the gateway to pick the model itself. */
export const MINUSX_AUTO_MODEL = 'minusx-auto';

/**
 * API-key sentinel for a workspace that has not configured anything yet. The
 * client lib requires SOME key (otherwise it errors locally, env-dependent);
 * this makes the unconfigured state deterministic — the request always reaches
 * the gateway, whose auth policy decides (e.g. reject with a message pointing
 * at Settings → Models).
 */
export const MINUSX_UNCONFIGURED_KEY = 'mx-unconfigured';

export function buildMinusxModel(baseUrl?: string, modelId?: string): Model<Api> {
  return buildCustomModel({
    baseUrl: baseUrl || MINUSX_GATEWAY_URL,
    id: modelId || MINUSX_AUTO_MODEL,
    provider: MINUSX_PROVIDER,
    name: 'MinusX',
    reasoning: true,
    input: ['text', 'image'],
  });
}

/** Call options for the gateway: the use-case routing header. */
export function minusxCallOptions(useCase: LlmUseCase, extraHeaders?: Record<string, string>): Record<string, unknown> {
  return { headers: { ...(extraHeaders ?? {}), [MX_USE_CASE_HEADER]: useCase } };
}
