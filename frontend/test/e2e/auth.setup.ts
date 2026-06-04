/**
 * Auth setup project (Tests/QA/Evals Arch V2 — Phase 4). Runs once before the
 * e2e specs (the chromium project depends on it) after the webServer is up.
 *
 * Seeds the workspace admin (idempotent) and logs in via the dev
 * `password === email` shortcut (active because `next dev` ⇒ NODE_ENV!=production),
 * persisting the session to storageState for all specs.
 */
import { test as setup } from '@playwright/test';
import path from 'node:path';

const AUTH_FILE = path.join(process.cwd(), 'test/e2e/.auth/admin.json');
export const ADMIN_EMAIL = 'e2e-admin@test.local';

setup('register + authenticate admin', async ({ page, request }) => {
  // Seed the workspace admin. 200 on first run; 409 "already initialized" on reuse — both fine.
  const reg = await request.post('/api/orgs/register', {
    data: {
      workspaceName: 'e2e-workspace', // letters/numbers/hyphens/underscores only
      adminName: 'E2E Admin',
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_EMAIL, // ≥8 chars; also matches the dev login shortcut
    },
  });
  // 200 first run, 409 on reuse; anything else (e.g. validation) is a real failure.
  if (![200, 201, 409].includes(reg.status())) {
    throw new Error(`register failed: ${reg.status()} ${await reg.text()}`);
  }

  await page.goto('/login');
  await page.getByPlaceholder('Email', { exact: true }).fill(ADMIN_EMAIL);
  const pw = page.getByPlaceholder('Password', { exact: true });
  await pw.fill(ADMIN_EMAIL);
  // Submit via Enter (the form has onSubmit={handleLogin}) — robust to the
  // Chakra Button's icon/loading markup that defeats a role+name locator.
  await pw.press('Enter');

  // Authenticated ⇒ redirected away from /login.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  // A freshly registered workspace lands in the setup wizard. Mark onboarding
  // complete deterministically via the same config write the Skip button does
  // (updateConfig → POST /api/configs), using the page's authenticated cookies.
  const cfg = await page.request.post('/api/configs', {
    data: { setupWizard: { status: 'complete' } },
  });
  if (!cfg.ok()) throw new Error(`mark onboarding complete failed: ${cfg.status()} ${await cfg.text()}`);

  await page.goto('/explore');
  await page.getByLabel('Chat message input').waitFor({ state: 'visible', timeout: 30_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
