/**
 * Dashboard-render QA flow (Tests/QA/Evals Arch V2 — Phase 5). Deterministic, no LLM:
 * discover an existing dashboard on the deployment → open it → assert its questions
 * executed and returned rows in Redux. Skips if the deployment has no dashboards.
 */
import { test } from '@playwright/test';
import { findFileOfType, openFile, assertDashboardRendered } from './flows';

test('open an existing dashboard, its questions render with data', async ({ page, request }) => {
  const id = await findFileOfType(request, 'dashboard');
  test.skip(!id, 'no dashboard found on this deployment');
  await openFile(page, id!);
  await assertDashboardRendered(page, id!, 1);
});
