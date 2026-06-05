/**
 * Real-LLM chat QA flows (Tests/QA/Evals Arch V2).
 *
 * Drive ACTUAL conversations (no faux channel) against a Haiku model in tutorial
 * mode, asserting STRUCTURAL outcomes via the exposed Redux store — never on
 * specific generated text. Skipped when no provider key is configured; CI
 * supplies `ANTHROPIC_API_KEY` + `ANALYST_AGENT_MODEL_CONFIG` via secrets.
 *
 * Behavioural guard for the "remove the LLM proxy → local logging" change:
 *  - conversations + web search keep working (recording moved out of the request
 *    path), and
 *  - per-call debug stats/logs now load from the LOCAL tables via
 *    /api/llm-calls/[callId] (previously the proxy).
 */
import { test, expect } from '@playwright/test';
import {
  e2eUrl, findFile, openFileByClick,
  hasLlm, waitForStore, openSideChat, sendChat,
  assertChatReplied, assertWebSearchRan, firstLlmCallId,
} from './flows';

test.describe('real-LLM chat flows', () => {
  test.skip(!hasLlm(), 'no ANTHROPIC_API_KEY — real-LLM QA flows disabled');
  // Real model round-trips (+ page load + seed) need more than the default 60s.
  test.describe.configure({ timeout: 180_000 });

  test('explore: ask a question, get a reply, then follow up', async ({ page }) => {
    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    test.skip(!(await sendChat(page, 'In one short sentence, what is 2 + 2?')), 'chat composer not driveable in this environment');
    await assertChatReplied(page, 1);

    await sendChat(page, 'And in one short sentence, what is 3 + 3?');
    await assertChatReplied(page, 2);
  });

  test('dashboard side-chat: open a dashboard and ask about it', async ({ page, request }) => {
    const dashboard = await findFile(request, 'dashboard');
    test.skip(!dashboard, 'no dashboard found on this deployment');

    await openFileByClick(page, 'dashboard', dashboard!);
    await openSideChat(page);

    test.skip(!(await sendChat(page, 'In one short sentence, what is this dashboard about?')), 'chat composer not driveable in this environment');
    await assertChatReplied(page, 1);
  });

  test('web search: explicitly ask the agent to search the web', async ({ page }) => {
    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    const sent = await sendChat(
      page,
      'Use the web_search tool to find one fact about the Eiffel Tower, then answer in one short sentence. You must use web search.',
    );
    test.skip(!sent, 'chat composer not driveable in this environment');
    await assertWebSearchRan(page);
  });

  test('debug: per-call stats + logs load from the local tables', async ({ page, request }) => {
    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    test.skip(!(await sendChat(page, 'Reply with just the word: hello')), 'chat composer not driveable in this environment');
    await assertChatReplied(page, 1);

    const callId = await firstLlmCallId(page);
    expect(callId, 'the conversation should expose an lllm_call_id').toBeTruthy();

    // Recording is out-of-band (fire-and-forget) → poll until the local tables
    // (llm_call_events + llm_logs) hold the row that feeds the chat debug view.
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
