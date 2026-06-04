/**
 * QA auth (Tests/QA/Evals Arch V2 — Phase 5). Logs in with env credentials and
 * saves storageState. Does NOT set the `?e2e` cookie — specs opt into the store
 * exposure themselves, so the runtime-gate negative test stays valid.
 *
 * Local (no QA_BASE_URL): seeds the workspace + marks onboarding complete.
 * Prod (QA_BASE_URL set): the account already exists — just log in.
 */
import { test as setup } from '@playwright/test';
import path from 'node:path';

const AUTH_FILE = path.join(process.cwd(), 'test/qa/.auth/qa.json');
const EXTERNAL = !!process.env.QA_BASE_URL;
const EMAIL = process.env.QA_EMAIL || 'qa-admin@test.local';
const PASSWORD = process.env.QA_PASSWORD || EMAIL;

setup('authenticate qa user', async ({ page, request }) => {
  if (!EXTERNAL) {
    // Local prod-ish server starts empty — seed the admin (idempotent).
    const reg = await request.post('/api/orgs/register', {
      data: { workspaceName: 'qa-workspace', adminName: 'QA Admin', adminEmail: EMAIL, adminPassword: PASSWORD },
    });
    if (![200, 201, 409].includes(reg.status())) {
      throw new Error(`qa register failed: ${reg.status()} ${await reg.text()}`);
    }
  }

  await page.goto('/login');
  await page.getByPlaceholder('Email', { exact: true }).fill(EMAIL);
  const pw = page.getByPlaceholder('Password', { exact: true });
  await pw.fill(PASSWORD);
  await pw.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

  if (!EXTERNAL) {
    await page.request.post('/api/configs', { data: { setupWizard: { status: 'complete' } } });
  }

  await page.context().storageState({ path: AUTH_FILE });
});
