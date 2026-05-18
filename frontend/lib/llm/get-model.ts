import { getModel as piGetModel, type Api, type Model } from '@mariozechner/pi-ai';
import { MX_API_BASE_URL, MX_API_KEY } from '@/lib/config';

export type { Api, Model };

export function getModel<P extends string, M extends string>(
  provider: P,
  model: M,
): Model<Api> {
  const base = piGetModel(provider as never, model as never);
  if (!MX_API_BASE_URL) return base;
  // The original (pre-proxy) base URL is what we want the proxy to forward
  // to. Pass it through as `x-original-base-url` so the proxy doesn't have
  // to infer the upstream from the path — provider-agnostic, no string
  // matching, works for any provider pi-ai supports.
  const originalBaseUrl = (base as unknown as { baseUrl?: string }).baseUrl;
  return {
    ...base,
    baseUrl: `${MX_API_BASE_URL}/proxy`,
    headers: {
      ...((base as unknown as { headers?: Record<string, string> }).headers ?? {}),
      'mx-api-key': MX_API_KEY,
      ...(originalBaseUrl ? { 'x-original-base-url': originalBaseUrl } : {}),
    },
  } as typeof base;
}
