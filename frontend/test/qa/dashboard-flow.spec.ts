/**
 * Dashboard-render QA flow (Tests/QA/Evals Arch V2). Deterministic, no LLM:
 * discover an existing tutorial dashboard → open it → assert its questions
 * executed and returned rows in Redux. Skips if the deployment has no
 * dashboards. Stays in tutorial mode throughout.
 */
import { test } from '@playwright/test';
import { findFile, openFileByClick, assertDashboardRendered } from './flows';

test('open an existing dashboard by clicking it, its questions render with data', async ({ page, request }) => {
  const file = await findFile(request, 'dashboard');
  test.skip(!file, 'no dashboard found on this deployment');
  await openFileByClick(page, 'dashboard', file!);
  await assertDashboardRendered(page, file!.id, 1);
});
