/**
 * QA app smoke (Tests/QA/Evals Arch V2 — Phase 5). Deterministic synthetic
 * check of a deployment — login works, the app loads with hydrated Redux, and
 * the chat surface is present. No LLM call (zero cost; the real-LLM eval is Phase 6).
 *
 * Uses the runtime opt-in (`?e2e=<secret>`) for Redux assertions; falls back to
 * DOM-only where the store isn't available.
 */
import { test, expect } from '@playwright/test';
import { getState } from '@/test/flows/e2e';
import { e2eUrl } from './flows';

test('deployment is healthy: authenticated, store hydrated, chat surface present', async ({ page }) => {
  // Opt into store exposure for this session (tutorial mode).
  await page.goto(e2eUrl('/'));
  await expect(page).not.toHaveURL(/\/login/);

  // Redux hydrated with the logged-in user + config (no LLM involved).
  await expect.poll(() => page.evaluate(() => !!(window as any).__MX_STORE__), { timeout: 15_000 }).toBe(true);
  const state = await getState<{ auth?: { user?: { email?: string } }; configs?: { config?: unknown } }>(page);
  expect(state.auth?.user?.email).toBeTruthy();
  expect(state.configs?.config).toBeTruthy();

  // The chat surface is reachable.
  await page.goto(e2eUrl('/explore'));
  await expect(page.getByLabel('Chat message input')).toBeVisible();
});
