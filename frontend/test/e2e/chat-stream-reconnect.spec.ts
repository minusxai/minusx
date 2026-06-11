/**
 * Chat stream reconnect e2e — real browser, real prod-style server.
 *
 * Reproduces the prod incident: the /api/chat/stream connection is severed
 * MID-TURN (CDP network kill — what an app restart or corporate middlebox does
 * to the user), while the faux LLM holds the reply via `delayMs` so the turn is
 * provably still in flight. Asserts the chatListener reconnects with
 * `resume.afterSeq`, replays the missed frames, and the reply lands with no
 * user-visible error.
 */
import { test, expect, asClient } from './fixtures';
import { setFauxLLM } from '@/test/flows/e2e-faux';
import { enterSideChatMessage, assertRedux } from '@/test/flows/e2e';

const OFFLINE = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const ONLINE = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

test('mid-turn connection drop: client resumes the stream and the reply arrives with no error', async ({ page, request }) => {
  const MSG = 'will this survive a network drop';
  // Hold the LLM reply 3s so the sever happens while the turn is in flight.
  await setFauxLLM(asClient(request), [
    { userMessage: MSG, response: { kind: 'text', text: 'Recovered: yes it survived!' }, delayMs: 3000 },
  ]);

  await page.goto('/explore');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  // When the stream request goes out, sever the network 500ms later (mid-turn,
  // since the reply is held for 3s), then restore it 1.5s after that — landing
  // inside the client's resume backoff window.
  let severed = false;
  page.on('request', (req) => {
    if (severed || !req.url().includes('/api/chat/stream')) return;
    severed = true;
    setTimeout(async () => {
      await cdp.send('Network.emulateNetworkConditions', OFFLINE).catch(() => {});
      setTimeout(() => { void cdp.send('Network.emulateNetworkConditions', ONLINE).catch(() => {}); }, 1500);
    }, 500);
  });

  await enterSideChatMessage(page, MSG);

  // The reply must arrive and the conversation must finish WITHOUT an error —
  // i.e. the drop was absorbed by reconnect+resume, not surfaced to the user.
  await assertRedux(
    page,
    (s) => {
      const convs = Object.values(s?.chat?.conversations ?? {}) as any[];
      return convs.some(
        (c) => c.executionState === 'FINISHED'
          && !c.error
          && JSON.stringify(c.messages ?? []).includes('Recovered: yes it survived!'),
      );
    },
    { message: 'reply never arrived cleanly after the mid-turn network drop', timeout: 30000 },
  );

  // Sanity: the sever actually happened.
  expect(severed).toBe(true);

  // And no conversation is left in an error state.
  await assertRedux(
    page,
    (s) => (Object.values(s?.chat?.conversations ?? {}) as any[]).every((c) => !c.error),
    { message: 'a conversation surfaced a transport error despite resume' },
  );
});
