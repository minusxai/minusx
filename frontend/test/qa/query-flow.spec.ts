/**
 * Query-execution QA flow (Tests/QA/Evals Arch V2 — Phase 5). Deterministic, no LLM:
 * discover an existing question on the deployment → open it → run → assert rows in
 * Redux. Exercises the connector/query path end-to-end. Skips if the deployment has
 * no questions.
 */
import { test } from '@playwright/test';
import { findFileOfType, openFile, runQuery, assertSomeQueryHasRows } from './flows';

test('open an existing question, run it, results land in Redux', async ({ page, request }) => {
  const id = await findFileOfType(request, 'question');
  test.skip(!id, 'no question found on this deployment');
  await openFile(page, id!);
  await runQuery(page);
  await assertSomeQueryHasRows(page);
});
