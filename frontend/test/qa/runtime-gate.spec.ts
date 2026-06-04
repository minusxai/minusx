/**
 * Runtime E2E gate verification (Tests/QA/Evals Arch V2 — Phase 5).
 *
 * Proves the prod-safe opt-in end-to-end against a build with the build-time
 * E2E flag OFF: the store is exposed ONLY when `?e2e=<secret>` is present (and
 * then persists via cookie). Runs locally against the prod-ish server and against
 * a real deployment.
 */
import { test, expect } from '@playwright/test';

const SECRET = process.env.QA_E2E_SECRET || 'local-qa-secret';

const storeExposed = (page: import('@playwright/test').Page) =>
  page.evaluate(() => typeof (window as unknown as { __MX_STORE__?: { getState?: unknown } }).__MX_STORE__?.getState === 'function');

test('store is NOT exposed without ?e2e (prod build, no opt-in)', async ({ page }) => {
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/login/);
  await page.waitForTimeout(500); // let the mount effect run
  expect(await storeExposed(page)).toBe(false);
});

test('?e2e=<secret> exposes the store and persists across navigation', async ({ page }) => {
  await page.goto(`/?e2e=${encodeURIComponent(SECRET)}`);
  await expect.poll(() => storeExposed(page), { timeout: 15_000 }).toBe(true);

  // The opt-in cookie persists it on a subsequent navigation (no param).
  await page.goto('/explore');
  await expect.poll(() => storeExposed(page), { timeout: 15_000 }).toBe(true);
});

test('a wrong ?e2e value does NOT expose the store', async ({ page }) => {
  await page.goto('/?e2e=definitely-not-the-secret');
  await page.waitForTimeout(500);
  expect(await storeExposed(page)).toBe(false);
});
