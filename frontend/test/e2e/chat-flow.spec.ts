/**
 * Chat flow e2e (Tests/QA/Evals Arch V2 — Phase 4a). The flagship proof:
 * a real browser drives the side chat, the faux LLM (via /api/test/faux) returns
 * a scripted reply, the reply lands in Redux, and we assert what the LLM received.
 *
 * Same flow shape a prod-QA run uses — only the LLM (faux vs real) differs.
 */
import { test, asClient } from './fixtures';
import { setFauxLLM, assertLLMReceived } from '@/test/flows/e2e-faux';
import { enterSideChatMessage, assertRedux } from '@/test/flows/e2e';

test('side chat: faux reply reaches Redux and the LLM received the message', async ({ page, request }) => {
  const MSG = 'what is the latest revenue';
  await setFauxLLM(asClient(request), [{ userMessage: MSG, response: { kind: 'text', text: 'Faux revenue reply!' } }]);

  await page.goto('/explore');
  await enterSideChatMessage(page, MSG);

  // The assistant reply (a completed TalkToUser tool call) lands in the active conversation.
  await assertRedux(
    page,
    (s) => {
      const convs = Object.values(s?.chat?.conversations ?? {});
      return convs.some(
        (c: any) => c.executionState === 'FINISHED' && JSON.stringify(c.messages ?? []).includes('Faux revenue reply!'),
      );
    },
    { message: 'assistant reply never reached Redux' },
  );

  // And the model was actually sent our message.
  await assertLLMReceived(asClient(request), (c) => c.userMessage.includes(MSG));
});
