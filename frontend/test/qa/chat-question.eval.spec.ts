/**
 * Measured QA flow: chat question (Tests/QA/Evals Arch V3 — measured flows).
 *
 * `*.eval.spec.ts` files are ordinary QA flows that ALSO record metrics
 * (tokens, pass/fail, screenshots) via the metrics fixture, so a run's
 * results can be reported and compared across runs by `scripts/qa-report.ts`.
 * They run wherever the QA suite runs; a measured harness selects just them
 * with `playwright test test/qa/*.eval.spec.ts`. Naming is the opt-in: a
 * file that deliberately spends real LLM tokens is visible at a glance.
 *
 * Same discipline as chat-flow.spec.ts: real model, structural assertions
 * only, tutorial mode, failures are failures.
 */
import {
  expect, e2eUrl, waitForStore, sendChat, assertChatReplied,
  latestConversationId, conversationUsage, hasLlm,
} from './flows';
import { test } from './metrics';

const FLOW = 'Chat Question';

test.describe('eval: chat question', () => {
  // Run whenever a model is reachable — a runner credential or a live target
  // with its own LLM. Fork PRs have neither and skip (see chat-flow.spec.ts).
  test.skip(!hasLlm() && !process.env.QA_BASE_URL, 'no provider credential and not targeting a deployment — real-LLM QA disabled');
  // Cold prod-build start: the first send can wait minutes for connections
  // + context to load before Send enables (see sendChat).
  test.describe.configure({ timeout: 480_000 });

  test('ask a question, measure tokens, capture the conversation', async ({ page, request, metrics }) => {
    metrics.flow(FLOW); // declared up front: a failure still reports pass:false

    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    expect(await sendChat(page, 'In one short sentence, what is 2 + 2?'), 'composer should be driveable').toBe(true);
    await assertChatReplied(page, 1);

    const id = await latestConversationId(page);
    expect(id, 'the turn should produce a conversation').toBeTruthy();

    // Usage from the app's own recorded call stats (the /debug batch source),
    // split the way /debug splits it. Cost first: provider-reported and
    // cache-aware, the spend comparand; the token rows show HOW it was spent.
    const usage = await conversationUsage(request, id!);
    metrics.record(FLOW, 'cost_usd', usage.cost);
    metrics.record(FLOW, 'input_cached_tokens', usage.inputCachedTokens);
    metrics.record(FLOW, 'input_uncached_tokens', usage.inputUncachedTokens);
    metrics.record(FLOW, 'output_tokens', usage.outputTokens);
    // No screenshot here: the image rows of the report are for comparing
    // AUTHORED ARTIFACTS (see story-create), not chat transcripts.
  });
});
