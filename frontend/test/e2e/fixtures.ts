/**
 * E2E test fixtures (Tests/QA/Evals Arch V2 — Phase 4).
 *
 * Extends the base test with per-test isolation: the faux LLM channel is reset
 * before each test so recordings/queues never leak between tests. `resetTutorial`
 * is exposed for specs that exercise tutorial-mode flows.
 */
import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { resetFauxLLM, type ApiClientLike } from '@/test/flows/e2e-faux';

/** Playwright's APIRequestContext satisfies the structural ApiClientLike shape. */
function asClient(request: APIRequestContext): ApiClientLike {
  return request as unknown as ApiClientLike;
}

export const test = base.extend<{ resetTutorial: () => Promise<void> }>({
  // Reset the faux channel before every test.
  page: async ({ page, request }, use) => {
    await resetFauxLLM(asClient(request));
    await use(page);
  },
  // Opt-in: restore tutorial+internals modes to pristine template state.
  resetTutorial: async ({ request }, use) => {
    await use(async () => {
      await request.post('/api/admin/reset-tutorial');
    });
  },
});

export { expect, asClient };
