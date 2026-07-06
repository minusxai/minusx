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
import type { FauxMatchDTO } from '@/lib/test/faux-llm-channel.server';

export type { FauxMatchDTO };

interface ApiResponseLike {
  json(): Promise<unknown>;
}
export interface ApiClientLike {
  post(url: string, opts?: { data?: unknown }): Promise<ApiResponseLike>;
  get(url: string): Promise<ApiResponseLike>;
}

/** Register content-keyed faux responses for the next interactions. */
export async function setFauxLLM(client: ApiClientLike, matches: FauxMatchDTO[]): Promise<void> {
  await client.post('/api/test/faux', { data: { matches } });
}

/** Clear recordings + drain faux queues (call in beforeEach). */
export async function resetFauxLLM(client: ApiClientLike): Promise<void> {
  await client.post('/api/test/faux/reset', { data: {} });
}
