/**
 * Measured QA flow: story creation (Tests/QA/Evals Arch V3 — measured flows).
 *
 * The heavyweight agentic flow: open the tutorial "Top Level Metrics"
 * dashboard, ask the side-chat to create a story out of it, and measure what
 * that actually cost. The recorded image is the RENDERED STORY — the artifact
 * itself — because the point of an image row is a human judging which run
 * produced the better document, not what the chat transcript looked like.
 *
 * Metrics: total_tokens (every LLM call in the conversation, all grades),
 * pass/fail, and the story screenshot. Structural assertions only: a story
 * file exists under /tutorial and its svg surface rendered content.
 */
import {
  expect, findFile, openFileByClick, openSideChat, sendChat, saveDraft,
  awaitReplyAnsweringClarifications, assertTutorialMode, latestConversationId, conversationUsage,
  hasLlm, fitViewportToSurface,
} from './flows';
import { test } from './metrics';

const FLOW = 'Story Creation';
const DASHBOARD_NAME = 'Top Level Metrics';

test.describe('eval: story creation', () => {
  test.skip(!hasLlm() && !process.env.QA_BASE_URL, 'no provider credential and not targeting a deployment — real-LLM QA disabled');
  // A real multi-tool agent turn — read the dashboard, author the story, then
  // self-review and edit it (observed: 30+ edits before finishing) — on top of
  // a possibly cold server: give the whole flow very generous headroom.
  test.describe.configure({ timeout: 1_500_000 });

  test('create a story out of the top-level metrics dashboard', async ({ page, request, metrics }) => {
    metrics.flow(FLOW); // declared up front: a failure still reports pass:false

    const dashboard = await findFile(request, 'dashboard', DASHBOARD_NAME);
    test.skip(!dashboard, 'no dashboard found on this deployment');

    await openFileByClick(page, 'dashboard', dashboard!);
    await assertTutorialMode(page); // the flow creates a file — never outside tutorial
    await openSideChat(page);
    expect(
      await sendChat(page, 'Create a story out of this dashboard'),
      'composer should be driveable',
    ).toBe(true);

    // The turn does real work (read the dashboard, author the story,
    // self-review and edit it) and pauses on clarifications (design/template)
    // and a navigation request — the helper answers those. A full authoring +
    // review cycle has been observed to exceed 10 minutes.
    await awaitReplyAnsweringClarifications(page, 1_200_000);

    // The agent leaves the authored story as a DRAFT and navigates to it
    // (the product flow: a human reviews, then saves). Save it like a user —
    // header Save → name → confirm — when the draft Save control is present.
    const save = page.getByLabel('Save', { exact: true }).filter({ visible: true }).first();
    if (await save.isVisible().catch(() => false)) {
      await saveDraft(page, `Eval Story ${Date.now()}`);
    }

    // The story must exist as a saved file under /tutorial. Discovery is
    // server-side (same /api/files listing the UI uses; drafts do NOT appear
    // in it), so this also proves the artifact persisted rather than merely
    // being rendered in the chat.
    let story: { id: number; name: string; path: string } | null = null;
    await expect
      .poll(async () => (story = await findFile(request, 'story')), {
        message: 'no story file appeared in tutorial mode after the turn',
        timeout: 60_000,
      })
      .toBeTruthy();
    expect(story!.path.startsWith('/tutorial'), `story ${story!.path} must live under /tutorial`).toBe(true);

    // Usage of the WHOLE conversation (analyst turn + any micro calls), from
    // the app's own recorded call stats. Cost first: provider-reported and
    // cache-aware, the honest spend comparand for a 30+-call agentic turn.
    const conversationId = await latestConversationId(page);
    expect(conversationId, 'the turn should produce a conversation').toBeTruthy();
    const usage = await conversationUsage(request, conversationId!);
    metrics.record(FLOW, 'cost_usd', usage.cost);
    metrics.record(FLOW, 'input_cached_tokens', usage.inputCachedTokens);
    metrics.record(FLOW, 'input_uncached_tokens', usage.inputUncachedTokens);
    metrics.record(FLOW, 'output_tokens', usage.outputTokens);

    // Make sure the story is open (the agent usually already navigated there;
    // otherwise open it like a user, folder → tile click) and wait for the
    // svg surface to render real content before capturing the ARTIFACT image.
    if (!new URL(page.url()).pathname.startsWith(`/f/${story!.id}`)) {
      await openFileByClick(page, 'story', story!);
    }
    const frame = page.frameLocator('iframe[title="Story document"]');
    await expect(frame.locator('svg[data-mx-story-svg] foreignObject')).toHaveCount(1, { timeout: 60_000 });
    // Capture the story IFRAME ELEMENT with the viewport grown to fit it:
    // Chromium paints iframe content only inside the viewport, so this is
    // what makes the FULL story render into one image (and any lazily
    // mounted sections become visible and mount). Restore afterwards.
    const surface = page.locator('iframe[title="Story document"]');
    const restore = await fitViewportToSurface(page, surface);
    await page.waitForTimeout(5_000); // relayout + section mount + charts settle
    await metrics.screenshot(page, FLOW, 'story', surface);
    await restore();
  });
});
