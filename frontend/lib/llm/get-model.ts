import { getModel as piGetModel, type Api, type Model } from '@mariozechner/pi-ai';
import { MX_API_BASE_URL, MX_API_KEY } from '@/lib/config';

export type { Api, Model };

export function getModel<P extends string, M extends string>(
  provider: P,
  model: M,
): Model<Api> {
  const base = piGetModel(provider as never, model as never);
  if (!MX_API_BASE_URL) return base;
  return {
    ...base,
    baseUrl: `${MX_API_BASE_URL}/proxy`,
    headers: {
      ...((base as unknown as { headers?: Record<string, string> }).headers ?? {}),
      'mx-api-key': MX_API_KEY,
    },
  } as typeof base;
}
