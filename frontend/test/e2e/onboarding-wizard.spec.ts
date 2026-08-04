/**
 * Onboarding wizard — real browser, real server, real DB.
 *
 * The unit tests for these fixes mount one component with mocked hooks. This spec exists because
 * that is exactly how one of them passed while being dead in production: a mock returned a
 * `content` payload the real API never sends. Here nothing is mocked below the HTTP boundary.
 *
 * The wizard's step lives in `config.setupWizard.step` and is written by the wizard itself on
 * every transition, so parking it at a step via POST /api/configs is the app's own mechanism, not
 * a test backdoor. That is what lets these cases run without driving two multi-minute agent runs.
 */
import { test, expect, type Page } from '@playwright/test';

/** Put the wizard at a given step, the same way `persistStep` does. */
async function parkWizardAt(page: Page, step: string, extras: Record<string, unknown> = {}) {
  const res = await page.request.post('/api/configs', {
    data: { setupWizard: { status: 'pending', step, ...extras } },
  });
  expect(res.ok(), `parking wizard at ${step}: ${res.status()}`).toBeTruthy();
}

async function setWizardComplete(page: Page) {
  const res = await page.request.post('/api/configs', {
    data: { setupWizard: { status: 'complete' } },
  });
  expect(res.ok()).toBeTruthy();
}

test.afterEach(async ({ page }) => {
  // Leave the workspace usable for the other specs, which assume onboarding is done.
  await setWizardComplete(page);
});

test('welcome: a click completes the typewriter instead of waiting it out', async ({ page }) => {
  await parkWizardAt(page, 'welcome');
  await page.goto('/hello-world');

  const skip = page.getByLabel('Skip setup');
  await skip.waitFor({ state: 'visible' });

  // Click a neutral part of the page — the point is that ANY click cuts it short.
  await page.mouse.click(20, 400);

  // The action cards are gated behind the greeting finishing, so their presence proves the
  // whole sequence completed rather than merely that some text is on screen. Without the fix
  // this takes ~18s; the timeout here is far below that.
  await expect(page.getByLabel('Connect your data')).toBeVisible({ timeout: 4_000 });
  await expect(page.getByLabel('Try demo')).toBeVisible();
});

test('slack step: says why it cannot connect instead of showing a dead card', async ({ page }) => {
  // This deployment is http://localhost — no SLACK_CLIENT_ID and no public HTTPS URL, so BOTH
  // capabilities are genuinely false. That combination is unreachable on any hosted environment,
  // which is precisely why it is worth pinning here.
  const caps = await page.request.get('/api/integrations/slack/oauth-configured');
  expect(caps.ok()).toBeTruthy();
  const body = await caps.json();
  expect(body.data).toMatchObject({ configured: false, selfHostedEnabled: false });

  await parkWizardAt(page, 'slack');
  await page.goto('/hello-world');

  await expect(page.getByLabel('Slack requires a public HTTPS URL')).toBeVisible();
  await expect(page.getByLabel('Add to Slack')).toHaveCount(0);
  await expect(page.getByLabel('Set up Slack in Settings')).toHaveCount(0);
  // Never a dead end.
  await expect(page.getByLabel('Skip for now')).toBeVisible();
});

test('completion screen does not claim work the workspace has not done', async ({ page }) => {
  await setWizardComplete(page);
  await page.goto('/hello-world');

  const connectRow = page.locator('[data-guide-item]').filter({ hasText: 'Connect a database' });
  await expect(connectRow).toBeVisible();
  // No connection in this workspace ⇒ no tick, and no "here's what I built" summary.
  await expect(connectRow.getByLabel(/done/i)).toHaveCount(0);
  await expect(page.getByLabel('What setup created')).toHaveCount(0);
});

test('upload step does not flag the dataset name before it is filled', async ({ page }) => {
  await parkWizardAt(page, 'connection');
  await page.goto('/hello-world');

  await page.getByText('CSV', { exact: true }).click();

  // The field is required — Upload stays disabled — but nothing is painted as an error yet.
  await expect(page.getByLabel('CSV dataset name')).toBeVisible();
  await expect(page.getByText('Enter a dataset name above to enable upload.')).toHaveCount(0);
  await expect(page.getByLabel('Upload files')).toBeDisabled();
});
