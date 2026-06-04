/**
 * Playwright-side helpers for the E2E faux LLM channel (Tests/QA/Evals Arch V2).
 *
 * Thin wrappers over `/api/test/faux*` that mirror the node `setFauxMatches`
 * vocabulary. `import type` only from the server channel — types are erased, so
 * this file never pulls the `server-only` module into the Playwright process.
 *
 * `client` is Playwright's `APIRequestContext` (typed structurally here so this
 * compiles before Playwright is installed in Phase 4).
 */
import type { FauxMatchDTO, RecordedLLMCall } from '@/lib/test/faux-llm-channel.server';

export type { FauxMatchDTO, RecordedLLMCall };

interface ApiResponseLike {
  json(): Promise<unknown>;
}
export interface ApiClientLike {
  post(url: string, opts?: { data?: unknown }): Promise<ApiResponseLike>;
  get(url: string): Promise<ApiResponseLike>;
}

type FauxResponseDTO = FauxMatchDTO['response'];
type StopReasonDTO = Extract<FauxResponseDTO, { kind: 'text' }>['stopReason'];

/** Convenience builders for the serializable response DTOs. */
export const faux = {
  text: (text: string, stopReason?: StopReasonDTO): FauxResponseDTO => ({
    kind: 'text',
    text,
    ...(stopReason ? { stopReason } : {}),
  }),
  toolCall: (name: string, args?: Record<string, unknown>, id?: string): FauxResponseDTO => ({
    kind: 'toolCall',
    name,
    ...(args ? { arguments: args } : {}),
    ...(id ? { id } : {}),
  }),
};

/** Register content-keyed faux responses for the next interactions. */
export async function setFauxLLM(client: ApiClientLike, matches: FauxMatchDTO[]): Promise<void> {
  await client.post('/api/test/faux', { data: { matches } });
}

/** Clear recordings + drain faux queues (call in beforeEach). */
export async function resetFauxLLM(client: ApiClientLike): Promise<void> {
  await client.post('/api/test/faux/reset', { data: {} });
}

/** Every LLM call the server recorded since the last configure/reset. */
export async function getLLMReceived(client: ApiClientLike): Promise<RecordedLLMCall[]> {
  const res = await client.get('/api/test/faux/received');
  const body = (await res.json()) as { received: RecordedLLMCall[] };
  return body.received;
}

/** Assert at least one recorded LLM call matches the predicate (what the model was sent). */
export async function assertLLMReceived(
  client: ApiClientLike,
  predicate: (call: RecordedLLMCall) => boolean,
): Promise<void> {
  const received = await getLLMReceived(client);
  if (!received.some(predicate)) {
    throw new Error(`No recorded LLM call matched the predicate. Received: ${JSON.stringify(received)}`);
  }
}
