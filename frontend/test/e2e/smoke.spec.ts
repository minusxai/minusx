/**
 * Boot + auth smoke (Tests/QA/Evals Arch V2 — Phase 4a). Validates the riskiest
 * assumptions before the full chat flow: the app boots under E2E_MODE, the
 * stored session authenticates, and the store is exposed on window.
 */
import { test, expect } from '@playwright/test';

test('app boots under E2E, session authenticates, store is exposed', async ({ page }) => {
  await page.goto('/');

  // Authenticated: not bounced to /login.
  await expect(page).not.toHaveURL(/\/login/);

  // E2E_MODE exposed the Redux store on window (poll: set in a mount effect).
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__MX_STORE__?.getState), { timeout: 30_000 })
    .toBe('function');

  const state = await page.evaluate(() => (window as any).__MX_STORE__.getState());
  expect(state).toHaveProperty('chat');
});
