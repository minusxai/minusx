/**
 * Query-execution QA flow (Tests/QA/Evals Arch V2). Deterministic, no LLM:
 * discover an existing tutorial question → open it → run it (real click) →
 * assert rows land in Redux. Exercises the connector/query path end-to-end.
 * Skips if the deployment has no questions. Stays in tutorial mode throughout.
 */
import { test } from '@playwright/test';
import { findFile, openFileByClick, runQuery, assertSomeQueryHasRows } from './flows';

test('open an existing question by clicking it, run it, results land in Redux', async ({ page, request }) => {
  const file = await findFile(request, 'question');
  test.skip(!file, 'no question found on this deployment');
  await openFileByClick(page, 'question', file!);
  await runQuery(page);
  await assertSomeQueryHasRows(page);
});
