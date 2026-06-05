/**
 * Cold-start warmup (runs once, before the parallel real-LLM chat flows).
 *
 * A freshly-built prod server loads + caches connections/context lazily on the
 * first chat, which leaves the composer's Send disabled until it's done. Driving
 * one real chat here warms that server-side cache so every parallel flow starts
 * against a warm server. Best-effort; a no-op without an LLM key.
 */
import { test } from '@playwright/test';
import { e2eUrl, hasLlm, waitForStore, sendChat, assertChatReplied } from './flows';

test('warm up the chat composer + server caches', async ({ page }) => {
  test.skip(!hasLlm(), 'no ANTHROPIC_API_KEY — real-LLM QA disabled');
  test.setTimeout(180_000);
  await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
  await waitForStore(page);
  if (await sendChat(page, 'hello')) {
    await assertChatReplied(page, 1).catch(() => { /* warmup is best-effort */ });
  }
});
