/**
 * Question authoring QA flow (Tests/QA/Evals Arch V2). Mutating + click-driven:
 * create a new question, type SQL into the editor, and save — then assert the
 * authored query persisted under /tutorial. Stays entirely in tutorial mode
 * (asserted before mutating; created path hard-checked after).
 *
 * Note: executing the query is intentionally NOT asserted here — a brand-new
 * question's runnable-DB availability is environment-specific (local tutorial
 * exposes no selectable database for new questions), and query execution is
 * already covered end-to-end by query-flow.spec.ts against an existing question.
 */
import { test } from '@playwright/test';
import {
  gotoTutorialHome,
  assertTutorialMode,
  createQuestion,
  typeQuery,
  saveDraft,
  assertQuestionSaved,
} from './flows';

test('author a new question, save — query persists in tutorial mode', async ({ page }) => {
  await gotoTutorialHome(page);
  await assertTutorialMode(page); // safety net: never mutate org/production

  const questionId = await createQuestion(page);
  await typeQuery(page, 'SELECT 1 AS n');
  await saveDraft(page, `qa-q-${Date.now()}`);

  await assertQuestionSaved(page, questionId); // also self-verifies the SQL was captured
});
