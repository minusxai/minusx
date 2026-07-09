/**
 * Navigate handler — Remote Agent Sessions skip the per-navigation confirmation.
 *
 * Normal chat: Navigate always asks the user ("Allow it?") — an accidental LLM navigation is
 * cheap to prevent. Remote sessions: the user granted STANDING consent by minting the session
 * (banner + Stop are always visible), and agent workflows navigate constantly (open dashboard →
 * new story → back), so per-hop confirms make the experience unusable. The handler must navigate
 * immediately when any conversation has an active remoteSession.
 */
import { navigateHandler } from '@/lib/tools/handlers/navigate';
import { UserInputException } from '@/lib/tools/user-input-exception';
import type { RootState } from '@/store/store';

const pushes: string[] = [];
vi.mock('@/lib/navigation/use-navigation', () => ({
  getRouter: () => ({ push: (href: string) => { pushes.push(href); } }),
  useRouter: () => null,
}));

function stateWithRemote(active: boolean): RootState {
  return {
    chat: {
      conversations: {
        900: { conversationID: 900, remoteSession: { active }, pending_tool_calls: [] },
      },
      inputHistory: [],
    },
    files: { files: { 42: { id: 42, content: { query: '' } } } },
  } as unknown as RootState;
}

describe('navigateHandler in remote sessions', () => {
  beforeEach(() => { pushes.length = 0; });

  it('normal chat: still asks for confirmation', async () => {
    await expect(
      navigateHandler({ file_id: 42 }, { state: stateWithRemote(false), userInputs: undefined }),
    ).rejects.toThrow(UserInputException);
    expect(pushes).toEqual([]);
  });

  it('remote session active: navigates immediately, no confirmation prompt', async () => {
    const result = await navigateHandler(
      { file_id: 42 },
      { state: stateWithRemote(true), userInputs: undefined },
    );
    expect((result.details as { success?: boolean }).success).toBe(true);
    expect(pushes).toEqual(['/f/42']);
  });
});
