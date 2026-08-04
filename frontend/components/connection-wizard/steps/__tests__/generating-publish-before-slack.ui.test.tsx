/**
 * Regression: taking the "Connect Slack →" branch out of the Build step used to advance the
 * wizard with a bare `onComplete()` — no `publishAll()`. The dashboard the agent had just built,
 * and every question in it, stay draft files. Draft files are invisible: `/api/files` does not
 * list them, the completion screen finds no dashboard to link to, and opening the dashboard by id
 * shows an empty "Let's build your dashboard" grid with 0 questions.
 *
 * So of the two buttons on the Build step's done screen, "Go to dashboard" kept your dashboard and
 * "Connect Slack" silently discarded it — with nothing in the UI distinguishing them.
 *
 * Guards: (1) Slack advance publishes first, (2) it still advances when publish throws, so a
 * publish failure cannot strand the user on the final step with no working control.
 */

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
const { DRAFT_ID } = vi.hoisted(() => ({ DRAFT_ID: 1013 }));

vi.mock('@/lib/file-state/file-state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/file-state/file-state')>('@/lib/file-state/file-state');
  return {
    ...actual,
    createDraftFile: vi.fn(async () => DRAFT_ID),
    publishAll: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
  };
});

// Put the step straight into its terminal "done" state. The rendered controls depend only on this
// outcome, so driving a real agent conversation to FINISHED would add mocking surface without
// exercising anything this regression is about.
vi.mock('@/components/connection-wizard/agent-outcome', () => ({
  wizardAgentOutcome: () => 'done',
}));

vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFile: () => ({ fileState: { id: DRAFT_ID, content: {}, persistableChanges: {} } }),
}));

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ databases: [], contextId: 1, contextLoading: false }),
}));

// Display-only agent-trace panel; the real one pulls in the whole chat UI.
vi.mock('@/components/explore/ChatInterface', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('div', { 'aria-label': 'chat interface' }) };
});

// ─── Imports ──────────────────────────────────────────────────────────────────
import type { Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { setUser } from '@/store/authSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StepGenerating from '@/components/connection-wizard/steps/StepGenerating';
import { publishAll } from '@/lib/file-state/file-state';

describe('StepGenerating — "Connect Slack" must persist the generated dashboard', () => {
  let store: ReturnType<typeof makeStore>;
  let onComplete: Mock<() => Promise<void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setUser({
      userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org',
    } as any));
    onComplete = vi.fn(async () => {});
  });

  function renderStep() {
    return renderWithProviders(
      <StepGenerating
        connectionName="static"
        contextFileId={1008}
        showSlackStep
        onComplete={onComplete}
      />,
      { store }
    );
  }

  it('publishes drafts before advancing to the Slack step', async () => {
    const user = userEvent.setup();
    renderStep();

    const slackButton = await screen.findByRole('button', { name: /Connect Slack/i });
    await user.click(slackButton);

    await waitFor(() => expect(publishAll).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Order matters: advancing first would unmount the step mid-publish.
    const publishOrder = (publishAll as any).mock.invocationCallOrder[0];
    const completeOrder = onComplete.mock.invocationCallOrder[0];
    expect(publishOrder).toBeLessThan(completeOrder);
  });

  it('still advances when publishing fails', async () => {
    (publishAll as any).mockRejectedValueOnce(new Error('HTTP 502: Bad Gateway'));
    const user = userEvent.setup();
    renderStep();

    const slackButton = await screen.findByRole('button', { name: /Connect Slack/i });
    await user.click(slackButton);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});
