/**
 * QA reset step (Tests/QA/Evals Arch V2 — Phase 5). Runs once after auth and
 * before the qa specs: login → **reset tutorial** → flows. Restores tutorial +
 * internals modes to the pristine template seed so every QA run starts from a
 * known state. Production (org) files are never touched.
 *
 * Best-effort: requires an admin QA account. On a non-admin account (or any
 * endpoint error) it's skipped + logged — the read-only flows still run against
 * whatever tutorial content exists. Uses the auth storageState (admin session).
 */
import { test as setup } from '@playwright/test';
import { resetTutorial } from './flows';

setup('reset tutorial to pristine seed', async ({ request }) => {
  await resetTutorial(request);
});
