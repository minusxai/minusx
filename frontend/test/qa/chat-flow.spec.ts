/**
 * Real-LLM chat QA flows (Tests/QA/Evals Arch V2).
 *
 * Drive ACTUAL conversations (no faux channel) against a real model in tutorial
 * mode, asserting STRUCTURAL outcomes via the exposed Redux store. The whole
 * describe is skipped when no provider key is configured; CI supplies
 * ANTHROPIC_API_KEY + ANALYST_AGENT_MODEL_CONFIG via secrets.
 *
 * These exercise the post-proxy behaviour end-to-end: conversations + web search
 * keep working with recording moved out of the request path, and per-call debug
 * stats/logs load from the LOCAL tables via /api/llm-calls/[callId].
 *
 * FAILURES ARE FAILURES. These flows fail RED when they fail — we do not swallow
 * errors into skips (that once masked a real chart-image bug: an LLM 400 turned a
 * broken flow green). Transient real-LLM flake is handled the right way, by
 * Playwright `retries` (see playwright.qa.config.ts) — retry once, only red if it
 * fails twice. The ONLY skips here are genuine preconditions: no provider key
 * (describe-level) or no dashboard present on the deployment.
 *
 * Cold start: there is no warmup priming the server, so the first parallel wave
 * pays the cold prod-build connection/context load directly — absorbed by the
 * generous Send-enable wait in sendChat and the describe timeout below.
 */
import { test, expect } from '@playwright/test';
import {
  e2eUrl, findFile, openFileByClick,
  hasLlm, waitForStore, openSideChat, sendChat,
  assertChatReplied, assertWebSearchRan, firstLlmCallId,
  stopAgent, assertAgentStopped, enableDebugUi, latestConversationId, assertConversationLoaded,
} from './flows';

test.describe('real-LLM chat flows', () => {
  test.skip(!hasLlm(), 'no ANTHROPIC_API_KEY — real-LLM QA flows disabled');
  // Real model round-trips (+ page load + seed) need far more than the default 60s.
  // With no warmup, the first parallel wave absorbs the cold prod-build start
  // (connections/context load can take a couple of minutes before Send enables —
  // see sendChat). This budget covers that cold first send plus the reply; every
  // later flow runs warm in seconds.
  test.describe.configure({ timeout: 480_000 });

  test('explore: ask a question, get a reply, then follow up', async ({ page }) => {
    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    expect(await sendChat(page, 'In one short sentence, what is 2 + 2?'), 'composer should be driveable').toBe(true);
    await assertChatReplied(page, 1);

    expect(await sendChat(page, 'And in one short sentence, what is 3 + 3?'), 'composer should accept a follow-up').toBe(true);
    await assertChatReplied(page, 2);
  });

  test('dashboard side-chat: open a dashboard and ask about it', async ({ page, request }) => {
    const dashboard = await findFile(request, 'dashboard');
    test.skip(!dashboard, 'no dashboard found on this deployment');

    await openFileByClick(page, 'dashboard', dashboard!);
    await openSideChat(page);
    expect(await sendChat(page, 'In one short sentence, what is this dashboard about?'), 'composer should be driveable').toBe(true);
    await assertChatReplied(page, 1);
  });

  test('web search: explicitly ask the agent to search the web', async ({ page }) => {
    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    expect(await sendChat(
      page,
      'Use the web_search tool to find one fact about the Eiffel Tower, then answer in one short sentence. You must use web search.',
    ), 'composer should be driveable').toBe(true);
    await assertWebSearchRan(page);
  });

  test('debug data: stats + request AND response load from the local tables', async ({ page, request }) => {
    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    expect(await sendChat(page, 'Reply with just the word: hello'), 'composer should be driveable').toBe(true);
    await assertChatReplied(page, 1);

    const callId = await firstLlmCallId(page);
    expect(callId, 'the conversation should expose an lllm_call_id').toBeTruthy();

    // The debug view reads stats (llm_call_events) + logs (llm_logs) from the
    // LOCAL tables, keyed by the same call id. Poll until both the request and
    // response have loaded.
    let body: { stats?: Record<string, unknown> | null; logs?: Record<string, unknown> | null } = {};
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/llm-calls/${callId}`);
          if (!res.ok()) return false;
          body = await res.json();
          return Boolean(body?.stats) && Boolean(body?.logs?.request_json) && Boolean(body?.logs?.response_json);
        },
        { message: 'stats + request_json + response_json did not load for the call', timeout: 30_000 },
      )
      .toBe(true);

    // Validate the CONTENT (real pi-format request/response) + a sane request length.
    const requestJson = String(body.logs!.request_json);
    const responseJson = String(body.logs!.response_json);
    expect(Array.isArray(JSON.parse(requestJson).messages), 'request is a pi context with messages').toBe(true);
    expect(requestJson.length, 'request blob is non-trivial').toBeGreaterThan(50);
    expect(JSON.parse(responseJson).role, 'response is an assistant message').toBe('assistant');
    expect(body.stats!.llm_call_id, 'stats row is for the same call').toBe(callId);
  });

  test('debug UI: enabling debug renders the request, response, and stats in the chat', async ({ page }) => {
    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    expect(await sendChat(page, 'Reply with just the word: hello'), 'composer should be driveable').toBe(true);
    await assertChatReplied(page, 1);

    const id = await latestConversationId(page);
    expect(id, 'the turn should produce a conversation').toBeTruthy();

    // Reload the saved conversation so its debug row is materialised, then turn
    // on the admin debug view.
    await page.goto(e2eUrl(`/explore/${id}`), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);
    await assertConversationLoaded(page, id!, 2);
    await enableDebugUi(page);

    // Expand the debug card → the LLM call → request/response/stats.
    const toggleCard = page.getByLabel('Toggle debug info').first();
    await expect(toggleCard).toBeVisible({ timeout: 30_000 });
    await toggleCard.click();
    const toggleCall = page.getByLabel('Toggle LLM details').first();
    await expect(toggleCall).toBeVisible({ timeout: 15_000 });
    await toggleCall.click();

    // The card shows stats + request + response from the local tables — this
    // catches a field-name mismatch between the API and the UI.
    await expect(page.getByLabel('LLM call stats').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Request body').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Response body').first()).toBeVisible({ timeout: 30_000 });
  });

  test('interrupt: clicking Stop halts a running agent', async ({ page }) => {
    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    // A web-search + long-write prompt runs long enough to interrupt.
    expect(
      await sendChat(page, 'Search the web, then write a detailed multi-paragraph history of the Eiffel Tower.'),
      'composer should be driveable',
    ).toBe(true);
    expect(await stopAgent(page), 'agent should still be running when Stop is clicked').toBe(true);
    await assertAgentStopped(page);
  });

  test('resume: reload a conversation and continue it', async ({ page }) => {
    await page.goto(e2eUrl('/explore'), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);

    expect(await sendChat(page, 'In one short sentence, what is 2 + 2?'), 'composer should be driveable').toBe(true);
    await assertChatReplied(page, 1);

    const id = await latestConversationId(page);
    expect(id, 'the turn should produce a conversation').toBeTruthy();

    // Reload the saved conversation by id, confirm it rehydrated, then continue it.
    await page.goto(e2eUrl(`/explore/${id}`), { waitUntil: 'domcontentloaded' });
    await waitForStore(page);
    await assertConversationLoaded(page, id!, 2);

    expect(await sendChat(page, 'And in one short sentence, what is 3 + 3?'), 'composer should accept a follow-up').toBe(true);
    await assertChatReplied(page, 2);
  });
});
