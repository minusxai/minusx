/**
 * Remote Agent Sessions ("Copy to Agent") e2e — real browser + the test itself playing the
 * external agent over plain HTTP (no LLM is involved in a remote session, so the loop is fully
 * deterministic). Covers the whole REMOTE_AGENT_SESSIONS.md §13.1 flow:
 *
 *   mint via real click → hard input freeze + banner → skill doc served → server tool executes
 *   → frontend-bridged tool round-trips through THIS browser (observer → auto-exec →
 *   completions POST → waiter) → user-message turns refused while remote → Stop unfreezes →
 *   dead code 404/410 → a NORMAL faux-LLM turn afterwards still works (log invariant).
 *
 * KEEP THIS SPEC: it is the only test that exercises the browser observer's XHR stream loop —
 * jsdom cannot (no usable XHR/SSE), so the ui/node layers deliberately leave it to this layer.
 */
import { test, expect } from './fixtures';
import { setFauxLLM } from '@/test/flows/e2e-faux';
import { enterSideChatMessage, assertRedux } from '@/test/flows/e2e';
import { asClient } from './fixtures';

test('full remote session loop: mint → freeze → tools (server + browser round-trip) → stop → normal chat', async ({ page, request }) => {
  // ── A conversation with messages (the header bar renders only then) ─────────────────────────
  await setFauxLLM(asClient(request), [
    { userMessage: 'hello there', response: { kind: 'text', text: 'Hi! Ready when you are.' } },
    { userMessage: 'summarize the session', response: { kind: 'text', text: 'Session summarized.' } },
  ]);
  await page.goto('/explore');
  await enterSideChatMessage(page, 'hello there');
  await assertRedux(
    page,
    (s) => (Object.values(s?.chat?.conversations ?? {}) as any[]).some(
      (c) => c.executionState === 'FINISHED' && JSON.stringify(c.messages ?? []).includes('Ready when you are'),
    ),
    { message: 'first faux turn never finished', timeout: 30000 },
  );

  // ── Mint via the real button; capture the code from the mint response ───────────────────────
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const mintResponse = page.waitForResponse(
    (r) => r.url().includes('/remote-session') && r.request().method() === 'POST',
  );
  await page.getByLabel('Copy to agent').click();
  const mint = (await (await mintResponse).json()).data as { code: string; url: string; copyText: string };
  expect(mint.code).toBeTruthy();

  // Freeze: banner + Stop visible, input hard-disabled.
  await expect(page.getByLabel('Remote session banner')).toBeVisible();
  await expect(page.getByLabel('Stop remote session')).toBeVisible();
  // The Lexical editor is a contenteditable div — "disabled" = contenteditable off + readonly.
  await expect(page.getByLabel('Chat message input')).toHaveAttribute('contenteditable', 'false');

  // Clipboard carries the exact one-liner.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(mint.copyText);

  const session = `/s/${mint.code}`;

  // ── The test IS the external agent from here ─────────────────────────────────────────────────
  const doc = await request.get(session);
  expect(doc.status()).toBe(200);
  const docText = await doc.text();
  expect(docText).toContain('ExecuteQuery');
  expect(docText).toContain(`${session}/tool`);
  expect(docText).not.toContain('ClarifyFrontend');

  // Server tool: executes in-process, no browser needed.
  const search = await request.post(`${session}/tool`, {
    data: { tool: 'SearchFiles', args: { query: 'revenue' } },
  });
  expect(search.status()).toBe(200);
  expect((await search.json()).status).toBe('completed');

  // Frontend-bridged tool: MUST round-trip through this real browser tab (observer → auto-exec
  // handler → completions POST → server waiter). A bogus fileId still proves the whole transport
  // loop — the browser executes the handler and returns its (tool-level) failure as the result.
  const edit = await request.post(`${session}/tool`, {
    data: { tool: 'EditFile', args: { fileId: 999999, name: 'nope' }, waitMs: 30000 },
  });
  expect(edit.status()).toBe(200);
  const editBody = await edit.json();
  expect(editBody.status).toBe('completed'); // the browser answered — transport loop proven

  // Mutual exclusion: a user-message turn is refused while the session holds the conversation.
  const convId = await page.evaluate(() => {
    const s = (window as any).__MX_STORE__.getState();
    const convs = Object.values(s.chat.conversations) as any[];
    return convs.find((c) => c.remoteSession?.active)?.conversationID;
  });
  expect(convId).toBeTruthy();
  const blocked = await request.post(`/api/conversations/${convId}/turns`, {
    data: { userMessage: 'let me in' },
  });
  expect(blocked.status()).toBe(409);

  // ── Stop from the banner: session ends, input unfreezes, no error artifact ──────────────────
  await page.getByLabel('Stop remote session').click();
  await expect(page.getByLabel('Remote session banner')).not.toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel('Chat message input')).toHaveAttribute('contenteditable', 'true');
  await assertRedux(
    page,
    (s) => (Object.values(s?.chat?.conversations ?? {}) as any[]).every((c) => !c.error),
    { message: 'Stop left an error artifact on the conversation' },
  );

  // The code is dead: skill doc 410, tool 404.
  expect((await request.get(session)).status()).toBe(410);
  expect((await request.post(`${session}/tool`, { data: { tool: 'SearchFiles', args: { query: 'x' } } })).status()).toBe(404);

  // ── Log invariant, end-to-end: a NORMAL faux-LLM turn on the same conversation still works ──
  await enterSideChatMessage(page, 'summarize the session');
  await assertRedux(
    page,
    (s) => (Object.values(s?.chat?.conversations ?? {}) as any[]).some(
      (c) => c.executionState === 'FINISHED' && !c.error
        && JSON.stringify(c.messages ?? []).includes('Session summarized.'),
    ),
    { message: 'normal turn after the remote session failed (log invariant broken)', timeout: 30000 },
  );
});
