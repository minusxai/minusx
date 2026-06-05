/**
 * Cold-start warmup (runs once, serially, before the parallel real-LLM chat flows).
 *
 * A freshly-started prod server is cold in several ways at once: Node's JIT is
 * unoptimised, PGLite's caches are empty, and the connections/context the chat
 * composer waits on haven't loaded — which leaves Send disabled and the first
 * couple of real chats slow. A single warmup chat isn't enough: the parallel
 * flows that follow then race a still-cold process and degrade to skips.
 *
 * So this drives BOTH heavy paths the flows use — an explore conversation (+ a
 * follow-up) and a dashboard side-chat — sequentially, up front. That warms every
 * route, the connection/context cache, the LLM + query-execution path, and the
 * dashboard render, so the parallel flows start against a fully-hot server (where
 * they each finish in seconds). Entirely best-effort: warmup never fails the run.
 */
import { test } from '@playwright/test';
import {
  e2eUrl, hasLlm, waitForStore, sendChat, assertChatReplied,
  findFile, openFileByClick, openSideChat,
} from './flows';

test('warm up the chat composer + server caches', async ({ page, request }) => {
  test.skip(!hasLlm(), 'no ANTHROPIC_API_KEY — real-LLM QA disabled');
  test.setTimeout(300_000);

  // 1. Explore: a full chat + a follow-up — warms the /explore route, the
  //    connection/context cache, the LLM + query path, and conversation resume.
  await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
  await waitForStore(page);
  if (await sendChat(page, 'Reply with just the word ok.')) {
    await assertChatReplied(page, 1).catch(() => { /* best-effort */ });
    if (await sendChat(page, 'Again, reply with just the word ok.')) {
      await assertChatReplied(page, 2).catch(() => { /* best-effort */ });
    }
  }

  // 2. Dashboard: open one + drive its side-chat — warms the folder/file routes,
  //    the dashboard render, and the sidebar composer the dashboard flow uses.
  const dashboard = await findFile(request, 'dashboard');
  if (dashboard) {
    try {
      await openFileByClick(page, 'dashboard', dashboard);
      await openSideChat(page);
      if (await sendChat(page, 'Reply with just the word ok.')) {
        await assertChatReplied(page, 1).catch(() => { /* best-effort */ });
      }
    } catch { /* best-effort — warmup never fails the run */ }
  }
});
