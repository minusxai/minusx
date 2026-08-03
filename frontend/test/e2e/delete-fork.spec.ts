/**
 * Delete-from-here e2e — real browser, faux LLM.
 *
 * "Delete from here" on a past user message forks the conversation at that
 * point WITHOUT running a turn: the user lands on a truncated copy with an
 * empty composer, and the ORIGINAL conversation is untouched server-side
 * (same append-only contract as edit-and-fork; shared fork endpoint).
 *
 * Also pins the affordance rules: the control is debug-gated (like Edit) and
 * never offered on the conversation's opening message — that fork would be an
 * empty conversation, so the user should just start a new chat instead.
 */
import { test, expect, asClient } from './fixtures';
import { setFauxLLM } from '@/test/flows/e2e-faux';
import { enterSideChatMessage, assertRedux } from '@/test/flows/e2e';

const MSG1 = 'first question about revenue';
const MSG2 = 'second question to be deleted';

test('delete-from-here forks without running a turn; original conversation unchanged', async ({ page, request }) => {
  await setFauxLLM(asClient(request), [
    { userMessage: MSG1, response: { kind: 'text', text: 'answer one' } },
    { userMessage: MSG2, response: { kind: 'text', text: 'answer two' } },
  ]);

  await page.goto('/explore');
  await enterSideChatMessage(page, MSG1);
  await assertRedux(page, (s) => JSON.stringify(s?.chat?.conversations ?? {}).includes('answer one'), {
    message: 'first faux reply should land', timeout: 30_000,
  });
  await enterSideChatMessage(page, MSG2);
  await assertRedux(page, (s) => JSON.stringify(s?.chat?.conversations ?? {}).includes('answer two'), {
    message: 'second faux reply should land', timeout: 30_000,
  });

  const srcId = await page.evaluate(() => {
    const s = (window as any).__MX_STORE__.getState();
    const ids = Object.keys(s.chat.conversations).map(Number);
    return Math.max(...ids);
  });

  // The controls are debug-gated, like Edit: without devMode neither renders.
  await page.getByText(MSG2).hover();
  await expect(page.getByLabel('Delete from here')).toHaveCount(0);

  await page.evaluate(() => {
    (window as any).__MX_STORE__.dispatch({ type: 'ui/setDevMode', payload: true });
  });

  // The FIRST user message must not offer Delete (its fork would be empty)…
  await page.getByText(MSG1).hover();
  await expect(page.getByLabel('Edit message')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Delete from here')).toHaveCount(0);

  // …the second one does. Delete it.
  await page.getByText(MSG2).hover();
  await page.getByLabel('Delete from here').click();

  // Redux moves to a NEW conversation containing only the first exchange, idle.
  let forkId = 0;
  await assertRedux(
    page,
    (s: any) => {
      const ids = Object.keys(s.chat.conversations).map(Number);
      const newId = Math.max(...ids);
      if (newId === srcId) return false;
      forkId = newId;
      const fork = s.chat.conversations[newId];
      const text = JSON.stringify(fork.messages ?? []);
      return (
        text.includes(MSG1) && text.includes('answer one') &&
        !text.includes(MSG2) && !text.includes('answer two') &&
        fork.executionState !== 'WAITING' && fork.executionState !== 'EXECUTING'
      );
    },
    { message: 'a truncated, idle fork should appear in Redux', timeout: 30_000 },
  );

  // No turn ran on the fork: the server log holds only the first exchange.
  const forkRes = await request.get(`/api/conversations/${forkId}`);
  expect(forkRes.ok()).toBe(true);
  const forkMsgs = JSON.stringify((await forkRes.json())?.data?.messages ?? []);
  expect(forkMsgs).toContain(MSG1);
  expect(forkMsgs).not.toContain(MSG2);

  // And the ORIGINAL conversation still holds both exchanges server-side.
  const srcRes = await request.get(`/api/conversations/${srcId}`);
  expect(srcRes.ok()).toBe(true);
  const srcMsgs = JSON.stringify((await srcRes.json())?.data?.messages ?? []);
  expect(srcMsgs).toContain(MSG1);
  expect(srcMsgs).toContain(MSG2);
});
