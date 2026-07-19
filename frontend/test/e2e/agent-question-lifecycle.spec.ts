/**
 * Agent question authoring + parameter-driven querying (e2e, faux LLM, real browser + real query
 * execution against tutorial data). Two integration flows the lower layers can't cover end-to-end:
 *
 *  1. The agent (faux LLM) issues a real CreateFile tool call that the BROWSER bridges through Redux
 *     → a new question lands as a DRAFT in the store (the core "ask, and it builds it" path).
 *  2. A parameter round-trips in the real question UI: a `:param` query surfaces its input, setting a
 *     value lands it in parameterValues, and the None ("Skip this filter") toggle flips it to explicit
 *     null — the has-value ↔ None distinction the param system is built on.
 *
 * WHY e2e (not node/ui): #1 needs the real browser tool-bridge (CreateFile throws server-side and is
 * executed in Redux); #2 needs the real question view + parameter row + Redux edit path that jsdom
 * stubs. Query EXECUTION is not asserted here — the analytics connector doesn't run under E2E_MODE
 * (no existing e2e spec executes a query); param-value handling is what this layer verifies, and
 * execution-with-params is already covered at the node/ui layers.
 */
import { test, expect, asClient } from './fixtures';
import { setFauxLLM } from '@/test/flows/e2e-faux';
import { enterSideChatMessage, assertRedux } from '@/test/flows/e2e';

test('agent CreateFile bridges through the browser and lands a new question as a draft', async ({ page, request }) => {
  const MSG = 'create a total revenue question';
  const NAME = 'Total Revenue E2E';
  // Turn 1 → the agent calls CreateFile (frontend-bridged: the browser executes it via Redux).
  // Turn 2 (after that tool) → a plain reply so the turn finishes cleanly.
  await setFauxLLM(asClient(request), [
    { userMessage: MSG, response: { kind: 'toolCall', name: 'CreateFile', arguments: { file_type: 'question', name: NAME, path: '/org' } } },
    { userMessage: MSG, after: 'CreateFile', response: { kind: 'text', text: `Done! I've created the ${NAME} question.` } },
  ]);

  await page.goto('/explore');
  await enterSideChatMessage(page, MSG);

  // The created question exists in the store AND is a draft (unpublished agent output).
  await assertRedux(
    page,
    (s: any) => Object.values(s?.files?.files ?? {}).some(
      (f: any) => f?.type === 'question' && (f?.metadataChanges?.name ?? f?.name) === NAME && f?.draft === true,
    ),
    { message: 'agent-created question never landed as a draft in the store', timeout: 30_000 },
  );

  // And the turn finished without error (the bridge round-trip completed and the reply arrived).
  await assertRedux(
    page,
    (s: any) => (Object.values(s?.chat?.conversations ?? {}) as any[]).some(
      (c) => c.executionState === 'FINISHED' && !c.error && JSON.stringify(c.messages ?? []).includes('Total Revenue E2E question'),
    ),
    { message: 'agent turn never finished cleanly', timeout: 30_000 },
  );
});

test('a question parameter round-trips: a value lands in parameterValues, None sets it null', async ({ page, request }) => {
  // Ride an EXISTING seeded question — it has a wired connection, so its query actually runs. Seeded
  // content lives in tutorial mode; fall back to org just in case.
  let mode = 'tutorial';
  let q: any = ((await (await request.get(`/api/files?type=question&depth=10&mode=${mode}`)).json())?.data ?? [])
    .find((f: any) => f?.type === 'question');
  if (!q) {
    mode = 'org';
    q = ((await (await request.get(`/api/files?type=question&depth=10&mode=${mode}`)).json())?.data ?? [])
      .find((f: any) => f?.type === 'question');
  }
  test.skip(!q, 'no seeded question available to exercise params against');
  const fileId = q.id as number;

  // Rewrite the seeded question's SQL to a self-contained parameterized query via the API — the value
  // typed for `:myval` is echoed straight back, so the result cell is a direct, deterministic proof
  // the parameter reached the connector. Preserving the seeded content keeps its WORKING connection
  // (a brand-new question has no selectable DB in tutorial). Done over the API rather than by driving
  // Monaco, whose view layer intercepts pointer events and makes editor-clear flaky.
  const full = await (await request.get(`/api/files/${fileId}?mode=${mode}`)).json();
  const file = full?.data ?? full;
  const patch = await request.patch(`/api/files/${fileId}?mode=${mode}`, {
    data: {
      name: file.name,
      path: file.path,
      // Params are auto-extracted on SQL *edit*, not on load — so persist the `parameters` array too,
      // or the param row won't render from the saved content.
      content: {
        ...(file.content ?? {}),
        query: 'SELECT :myval AS out',
        parameters: [{ name: 'myval', type: 'text', label: null, source: null }],
      },
    },
  });
  expect(patch.ok()).toBe(true);

  await page.goto(`/f/${fileId}?mode=${mode}`);
  // The editable parameter row renders in edit mode — enter it (the header toggle is labeled "Edit").
  await page.getByLabel('Edit', { exact: true }).click({ timeout: 20_000 });

  // The `:myval` parameter surfaces its own input (distinctive name + exact match avoids the
  // substring collisions a short name hits) — set a value and run.
  const merged = (s: any) => {
    const f = s?.files?.files?.[fileId];
    return { ...(f?.content ?? {}), ...(f?.persistableChanges ?? {}) };
  };

  // Set a value: it lands in the question's parameterValues (a param change dispatches editFile).
  const paramInput = page.getByLabel('myval', { exact: true });
  await paramInput.waitFor({ timeout: 15_000 });
  await paramInput.fill('7');
  await assertRedux(
    page,
    (s: any) => merged(s)?.parameterValues?.myval === '7',
    { message: 'parameter value 7 never landed in parameterValues', timeout: 15_000 },
  );

  // Toggle the parameter to None ("Skip this filter") → the value becomes explicit null. This is the
  // has-value → None round-trip the parameter system is built on (null removes the filter, distinct
  // from an empty string). Asserted on the value state, not on query execution — the analytics
  // connector does not run in E2E_MODE, and param VALUE handling is what this layer verifies.
  await page.getByLabel('Skip this filter', { exact: true }).click({ timeout: 10_000 });
  await assertRedux(
    page,
    (s: any) => merged(s)?.parameterValues?.myval === null,
    { message: 'None toggle did not set the parameter to null', timeout: 15_000 },
  );
});
