/**
 * QA workspace provisioning (Tests/QA/Evals Arch V3 — measured flows).
 *
 * Env-gated head of the setup chain: when `QA_PROVISION_WORKSPACE` is set,
 * register a FRESH workspace through the real registration UI — the
 * "Set Up Your Workspace" form at `/login?register` — before anything logs
 * in. Because this is a browser flow (not an API shortcut), every measured
 * run also QAs registration itself.
 *
 * When the env is unset (CI, the existing deployment QA action, local runs),
 * this is a no-op and the target is assumed pre-provisioned, exactly as today.
 *
 * Env:
 *   QA_PROVISION_WORKSPACE  workspace name to create (also gates the step)
 *   QA_PROVISION_ROOT_URL   where the registration form lives — defaults to
 *                           baseURL. Deployments that serve each workspace on
 *                           its own host register on the ROOT host and land on
 *                           the workspace's host afterwards; QA_BASE_URL must
 *                           then be the expected workspace URL.
 *   QA_EMAIL / QA_PASSWORD  become the new workspace's admin credentials
 *
 * After submit the form either follows the server's redirect (a per-workspace
 * host → we must end up on baseURL's host) or, on a single-workspace target,
 * flips to login mode with a success notice. Both count as provisioned.
 */
import { test as setup, expect } from '@playwright/test';

const WORKSPACE = process.env.QA_PROVISION_WORKSPACE;
const ROOT_URL = process.env.QA_PROVISION_ROOT_URL;
const EMAIL = process.env.QA_EMAIL || 'qa-admin@test.local';
const PASSWORD = process.env.QA_PASSWORD || EMAIL;

setup('provision a fresh workspace via the registration form', async ({ page, baseURL }) => {
  setup.skip(!WORKSPACE, 'QA_PROVISION_WORKSPACE not set — target assumed pre-provisioned');
  setup.setTimeout(180_000); // registration seeds a full workspace server-side

  const root = (ROOT_URL || baseURL || '').replace(/\/$/, '');
  await page.goto(`${root}/login?register`, { waitUntil: 'domcontentloaded' });

  // Placeholder/role locators, like auth.setup's login form (the standing
  // structural exception to getByLabel): registration must drive deployments
  // that predate the form's aria-labels. Scope to the form — the page chrome
  // has its own checkbox (the color-mode switch).
  const form = page.locator('form');

  // HYDRATION GATE. Clicking Create Workspace before React has hydrated
  // performs a NATIVE form submission — the page reloads at /login with the
  // query stripped and the registration silently never happens (observed on a
  // live target). The terms checkbox doubles as the gate: its styled control
  // only reaches data-state="checked" via React state, so keep clicking until
  // that sticks — after which every handler on the form is live.
  const tosControl = form.locator('[data-scope="checkbox"][data-part="control"]');
  await tosControl.waitFor({ state: 'visible', timeout: 60_000 });
  await expect
    .poll(
      async () => {
        if ((await tosControl.getAttribute('data-state')) === 'checked') return true;
        await tosControl.click();
        return (await tosControl.getAttribute('data-state')) === 'checked';
      },
      { message: 'terms checkbox never reflected React state — page did not hydrate', timeout: 60_000 },
    )
    .toBe(true);

  await form.getByPlaceholder('Workspace Name', { exact: true }).fill(WORKSPACE!);
  await form.getByPlaceholder('Your Name', { exact: true }).fill('QA Admin');
  await form.getByPlaceholder('Email', { exact: true }).fill(EMAIL);
  await form.getByPlaceholder('Password', { exact: true }).fill(PASSWORD);
  await form.getByRole('button', { name: 'Create Workspace' }).click();

  // Success is either landing on the workspace's own host (server redirect)
  // or the in-place "created successfully" notice (single-workspace target).
  const expectedHost = new URL(baseURL!).host;
  await expect
    .poll(
      async () => {
        const onWorkspaceHost = new URL(page.url()).host === expectedHost;
        const created = await page
          .getByText('created successfully', { exact: false })
          .isVisible()
          .catch(() => false);
        return onWorkspaceHost || created;
      },
      { message: `registration did not land on ${expectedHost} or confirm creation`, timeout: 120_000 },
    )
    .toBe(true);
});
