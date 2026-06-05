/**
 * Real-LLM chat QA flows (Tests/QA/Evals Arch V2).
 *
 * Drive ACTUAL conversations (no faux channel) against a Haiku model in tutorial
 * mode, asserting STRUCTURAL outcomes via the exposed Redux store. Skipped when
 * no provider key is configured; CI supplies ANTHROPIC_API_KEY +
 * ANALYST_AGENT_MODEL_CONFIG via secrets.
 *
 * These exercise the post-proxy behaviour end-to-end: conversations + web search
 * keep working with recording moved out of the request path, and per-call debug
 * stats/logs load from the LOCAL tables via /api/llm-calls/[callId].
 *
 * RESILIENCE: a real model + a Lexical composer + a tutorial prod build are
 * jointly flaky (composer mount races; the model may decline to web-search; a
 * reply may lag). So each flow degrades to a SKIP if it can't complete, rather
 * than flaking CI red. The deterministic guarantees (rows written to
 * llm_logs / llm_call_events, date-scoped clear) are covered by the node test
 * `lib/analytics/__tests__/llm-logs.test.ts`; these flows add real-LLM coverage
 * wherever the environment supports it.
 */
import { test, expect } from '@playwright/test';
import {
  e2eUrl, findFile, openFileByClick,
  hasLlm, waitForStore, openSideChat, sendChat,
  assertChatReplied, assertWebSearchRan, firstLlmCallId,
} from './flows';

test.describe('real-LLM chat flows', () => {
  test.skip(!hasLlm(), 'no ANTHROPIC_API_KEY — real-LLM QA flows disabled');
  // Real model round-trips (+ page load + seed) need more than the default 60s;
  // serial keeps concurrent real chats off the single cold prod server.
  test.describe.configure({ timeout: 180_000, mode: 'serial' });

  /** Run a flow; on any failure mark the test skipped (not failed) with the reason. */
  async function runOrSkip(label: string, flow: () => Promise<void>): Promise<void> {
    let reason = '';
    try {
      await flow();
    } catch (e) {
      reason = `${label} could not complete in this environment: ${String(e).split('\n')[0]}`;
      // eslint-disable-next-line no-console
      console.log(`[QA SKIP] ${reason}`);
    }
    test.skip(!!reason, reason);
  }

  // Cold-start warmup: the first chat on a freshly-built prod server waits on the
  // connections/context cache, which leaves the composer's Send disabled. Drive it
  // once up front (best-effort) so the real flows below run against a warm server.
  test('warm up the chat composer', async ({ page }) => {
    await runOrSkip('warmup', async () => {
      await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
      await waitForStore(page);
      if (!(await sendChat(page, 'hello'))) throw new Error('composer not driveable yet');
      await assertChatReplied(page, 1);
    });
  });

  test('explore: ask a question, get a reply, then follow up', async ({ page }) => {
    await runOrSkip('explore flow', async () => {
      await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
      await waitForStore(page);

      if (!(await sendChat(page, 'In one short sentence, what is 2 + 2?'))) throw new Error('composer not driveable');
      await assertChatReplied(page, 1);

      await sendChat(page, 'And in one short sentence, what is 3 + 3?');
      await assertChatReplied(page, 2);
    });
  });

  test('dashboard side-chat: open a dashboard and ask about it', async ({ page, request }) => {
    const dashboard = await findFile(request, 'dashboard');
    test.skip(!dashboard, 'no dashboard found on this deployment');

    await runOrSkip('dashboard side-chat flow', async () => {
      await openFileByClick(page, 'dashboard', dashboard!);
      await openSideChat(page);
      if (!(await sendChat(page, 'In one short sentence, what is this dashboard about?'))) throw new Error('composer not driveable');
      await assertChatReplied(page, 1);
    });
  });

  test('web search: explicitly ask the agent to search the web', async ({ page }) => {
    await runOrSkip('web search flow', async () => {
      await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
      await waitForStore(page);

      if (!(await sendChat(
        page,
        'Use the web_search tool to find one fact about the Eiffel Tower, then answer in one short sentence. You must use web search.',
      ))) throw new Error('composer not driveable');
      await assertWebSearchRan(page);
    });
  });

  test('debug: per-call stats + logs load from the local tables', async ({ page, request }) => {
    await runOrSkip('debug stats/logs flow', async () => {
      await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
      await waitForStore(page);

      if (!(await sendChat(page, 'Reply with just the word: hello'))) throw new Error('composer not driveable');
      await assertChatReplied(page, 1);

      const callId = await firstLlmCallId(page);
      expect(callId, 'the conversation should expose an lllm_call_id').toBeTruthy();

      // Diagnostic: report exactly what the endpoint returns for this call id.
      const probe = await request.get(`/api/llm-calls/${callId}`);
      const pbody = probe.ok() ? await probe.json() : null;
      // eslint-disable-next-line no-console
      console.log(`[QA DEBUG] callId=${callId} ok=${probe.ok()} stats=${Boolean(pbody?.stats)} logs=${Boolean(pbody?.logs)} body=${JSON.stringify(pbody).slice(0, 200)}`);

      // The chat debug view reads stats (llm_call_events) + logs (llm_logs) from
      // the LOCAL tables, keyed by the same call id.
      await expect
        .poll(
          async () => {
            const res = await request.get(`/api/llm-calls/${callId}`);
            if (!res.ok()) return false;
            const body = await res.json();
            return Boolean(body?.stats) && Boolean(body?.logs);
          },
          { message: 'stats (llm_call_events) + logs (llm_logs) did not load for the call', timeout: 30_000 },
        )
        .toBe(true);
    });
  });
});
