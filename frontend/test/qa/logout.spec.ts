// QA logout flow: clicking Logout must actually clear the session — it redirects
// to /login, and afterwards visiting / (with no e2e bypass) bounces back to
// /login instead of loading the app. Real auth, no LLM.
import { test, expect } from '@playwright/test';
import { e2eUrl, waitForStore } from './flows';

test('logout clears the session and re-gates the app', async ({ page }) => {
  // Starts authenticated via the shared QA storageState.
  await page.goto(e2eUrl('/'));
  await expect(page).not.toHaveURL(/\/login/);
  // The account menu is a div-trigger Chakra menu: a pre-hydration click is a no-op
  // (handler not attached yet) and the menu never opens. Wait for the app to hydrate.
  await waitForStore(page);

  // Open the account menu and click Logout.
  await page.getByLabel('Account menu').click();
  await page.getByLabel('Logout').click();

  // Logout lands on the login page.
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  // Session is genuinely cleared: visiting / (plain — no e2e param) redirects to /login.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
