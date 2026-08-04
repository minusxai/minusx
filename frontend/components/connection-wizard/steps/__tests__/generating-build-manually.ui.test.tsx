/**
 * Regression: "Build dashboard manually" and "Go home" had byte-identical handler bodies —
 * interrupt the agent, discardDraftFiles(), onComplete(), router.push('/p/org').
 *
 * So the control that offers to let you finish the dashboard yourself deleted the draft
 * dashboard first and dropped you on the home folder, with nothing to build on and no
 * indication anything had been thrown away. Two differently-labelled buttons, one behaviour,
 * and the label was the opposite of what happened.
 *
 * "Build dashboard manually" now keeps what the agent produced and opens it, so the user
 * lands on the thing they said they wanted to work on. "Go home" keeps the discard.
 */

const { DRAFT_ID } = vi.hoisted(() => ({ DRAFT_ID: 1013 }));

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/lib/file-state/file-state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/file-state/file-state')>('@/lib/file-state/file-state');
  return {
    ...actual,
    createDraftFile: vi.fn(async () => DRAFT_ID),
    publishAll: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
  };
});

// Park the step in its mid-run state, where the two skip links live.
vi.mock('@/components/connection-wizard/agent-outcome', () => ({
  wizardAgentOutcome: () => 'running',
}));

vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFile: () => ({ fileState: { id: DRAFT_ID, content: {}, persistableChanges: {} } }),
}));

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ databases: [], contextId: 1, contextLoading: false }),
}));

vi.mock('@/components/explore/ChatInterface', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('div', { 'aria-label': 'chat interface' }) };
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { setUser } from '@/store/authSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StepGenerating from '@/components/connection-wizard/steps/StepGenerating';
import { publishAll, deleteFile } from '@/lib/file-state/file-state';

function render() {
  const store = makeStore();
  store.dispatch(setUser({
    userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org',
  } as never));
  return renderWithProviders(
    <StepGenerating connectionName="static" contextFileId={1008} onComplete={vi.fn(async () => {})} />,
    { store }
  );
}

describe('StepGenerating — "Build dashboard manually" vs "Go home"', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('"Build dashboard manually" keeps the draft and opens the dashboard', async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /Build dashboard manually/i }));

    expect(publishAll).toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining(`/f/${DRAFT_ID}`));
  });

  it('"Go home" still discards the drafts and goes to the home folder', async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /Go home/i }));

    expect(publishAll).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('/p/org'));
  });
});
