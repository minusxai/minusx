/**
 * Reopening a conversation paused on a Clarify must render an ANSWERABLE prompt. A cold-loaded pending
 * tool has no `userInputs`, so nothing interactive rendered (the reopened chat was stuck).
 * `seedPendingClarifyInputs` reconstructs a `userInputs` entry from the tool args so the option
 * buttons render and are clickable again. The answerable surface is PendingClarifyPanel (rendered
 * outside the working area); this guards that render path.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { loadConversation } from '@/store/chatSlice';
import { seedPendingClarifyInputs } from '@/lib/chat/clarify-answer-stash';
import PendingClarifyPanel from '@/components/explore/PendingClarifyPanel';

const ARGS = { question: 'Who is this for?', options: [{ label: 'Execs' }, { label: 'Team' }] };

function setup(seed: boolean) {
  const store = makeStore();
  const pending = [{ id: 'tc_1', name: 'ClarifyFrontend', arguments: ARGS }];
  const pendingToolCalls = seed
    ? seedPendingClarifyInputs(1, pending, () => 'uid_1').pendingToolCalls
    // Pre-fix cold load: a bare pending tool with NO userInputs.
    : [{ toolCall: { id: 'tc_1', type: 'function' as const, function: { name: 'ClarifyFrontend', arguments: ARGS } }, result: undefined }];

  store.dispatch(loadConversation({
    conversation: {
      _id: 'c1', conversationID: 1, log_index: 0, messages: [], executionState: 'EXECUTING',
      pending_tool_calls: pendingToolCalls as never, streamedCompletedToolCalls: [], streamedThinking: '', version: 3,
    } as never,
    setAsActive: false,
  }));

  renderWithProviders(<PendingClarifyPanel conversationID={1} toolCallIds={['tc_1']} />, { store });
}

describe('reopened Clarify — answerable via seeded userInputs', () => {
  it('renders clickable option buttons when userInputs are seeded (the fix)', () => {
    setup(true);
    expect(screen.getByLabelText('Waiting for your input')).toBeInTheDocument();
    expect(screen.getByLabelText('Execs')).toBeInTheDocument();
    expect(screen.getByLabelText('Team')).toBeInTheDocument();
  });

  it('WITHOUT seeded userInputs the prompt is NOT answerable (the bug being fixed)', () => {
    setup(false);
    expect(screen.queryByLabelText('Execs')).not.toBeInTheDocument();
  });
});
