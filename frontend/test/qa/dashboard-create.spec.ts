/**
 * Dashboard authoring QA flow (Tests/QA/Evals Arch V2). Mutating + click-driven:
 * create a new dashboard, add an existing tutorial question to it, and save —
 * then assert it persisted under /tutorial with the question. Stays entirely in
 * tutorial mode (asserted before mutating; created path hard-checked after).
 */
import { test } from '@playwright/test';
import {
  gotoTutorialHome,
  assertTutorialMode,
  createDashboard,
  addFirstQuestion,
  saveDraft,
  assertDashboardSavedWithQuestion,
} from './flows';

test('create a dashboard, add a question, save — persists in tutorial mode', async ({ page }) => {
  await gotoTutorialHome(page);
  await assertTutorialMode(page); // safety net: never mutate org/production

  const dashboardId = await createDashboard(page);
  await addFirstQuestion(page);
  await saveDraft(page, `qa-dash-${Date.now()}`);

  await assertDashboardSavedWithQuestion(page, dashboardId);
});
