/**
 * When the agent asks several clarifications at once, EVERY unanswered one must be visible and
 * answerable simultaneously in a prominent "Waiting for your input" panel rendered OUTSIDE the
 * task/working block. Previously the interactive forms lived inside the detail carousel, which
 * shows one card at a time: the second and third clarifications were buried behind nav dots and
 * the user had no cue the agent was still waiting on them.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { loadConversation } from '@/store/chatSlice';
import AgentTurnContainer from '@/components/explore/AgentTurnContainer';
import { ClarifyDetailCard } from '@/components/explore/tools/ClarifyDisplay';

const ARGS_A = { question: 'Test clarification A: choose an option.', options: [{ label: 'Option A1' }, { label: 'Option A2' }] };
const ARGS_B = { question: 'Test clarification B: choose an option.', options: [{ label: 'Option B1' }, { label: 'Option B2' }] };

function makeUserInput(id: string, args: typeof ARGS_A) {
  return {
    id,
    props: {
      type: 'choice' as const,
      title: 'Clarification needed',
      message: args.question,
      options: args.options,
      cancellable: true,
    },
    result: undefined,
  };
}

function makePendingClarify(tcId: string, uiId: string, args: typeof ARGS_A) {
  return {
    toolCall: { id: tcId, type: 'function' as const, function: { name: 'ClarifyFrontend', arguments: args } },
    result: undefined,
    userInputs: [makeUserInput(uiId, args)],
  };
}

function makePendingToolMsg(tcId: string, args: typeof ARGS_A) {
  return {
    role: 'tool' as const,
    tool_call_id: tcId,
    content: '(executing...)',
    isPending: true,
    run_id: 'pending',
    function: { name: 'ClarifyFrontend', arguments: JSON.stringify(args) },
    created_at: '2026-07-23T00:00:00.000Z',
  };
}

function setupTurn(pendingToolCalls: unknown[], agentMessages: unknown[]) {
  const store = makeStore();
  store.dispatch(loadConversation({
    conversation: {
      _id: 'c1', conversationID: 1, log_index: 0, messages: [], executionState: 'EXECUTING',
      pending_tool_calls: pendingToolCalls as never,
      streamedCompletedToolCalls: [], streamedThinking: '', version: 3,
    } as never,
    setAsActive: false,
  }));

  renderWithProviders(
    <AgentTurnContainer
      turn={{
        userMessage: { role: 'user', content: 'help me build a dashboard' } as never,
        agentMessages: agentMessages as never,
      }}
      isCompact={false}
      databaseName=""
      showThinking={false}
      toggleShowThinking={() => {}}
      markdownContext="sidebar"
      readOnly={false}
      conversationID={1}
      isLastTurn
    />,
    { store },
  );
  return store;
}

describe('pending clarifications panel (outside the task block)', () => {
  it('shows ALL pending clarifications at once, not just the first carousel card', () => {
    setupTurn(
      [makePendingClarify('tc_a', 'uid_a', ARGS_A), makePendingClarify('tc_b', 'uid_b', ARGS_B)],
      [makePendingToolMsg('tc_a', ARGS_A), makePendingToolMsg('tc_b', ARGS_B)],
    );

    expect(screen.getByLabelText('Waiting for your input')).toBeInTheDocument();
    // Both clarification forms are visible and answerable simultaneously
    expect(screen.getByLabelText('Option A1')).toBeInTheDocument();
    expect(screen.getByLabelText('Option A2')).toBeInTheDocument();
    expect(screen.getByLabelText('Option B1')).toBeInTheDocument();
    expect(screen.getByLabelText('Option B2')).toBeInTheDocument();
  });

  it('answering the first clarification keeps the second visible and answerable', () => {
    setupTurn(
      [makePendingClarify('tc_a', 'uid_a', ARGS_A), makePendingClarify('tc_b', 'uid_b', ARGS_B)],
      [makePendingToolMsg('tc_a', ARGS_A), makePendingToolMsg('tc_b', ARGS_B)],
    );

    fireEvent.click(screen.getByLabelText('Option A1'));
    fireEvent.click(screen.getAllByLabelText('Submit clarification')[0]);

    // A's form is gone, B's is still there — no carousel click needed
    expect(screen.queryByLabelText('Option A1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Option B1')).toBeInTheDocument();
    expect(screen.getByLabelText('Waiting for your input')).toBeInTheDocument();
  });

  it('renders no waiting panel when nothing is pending', () => {
    const completedMsg = {
      role: 'tool' as const,
      tool_call_id: 'tc_done',
      content: JSON.stringify({ success: true, details: { selection: { label: 'Option A1' } } }),
      run_id: 'r1',
      function: { name: 'ClarifyFrontend', arguments: JSON.stringify(ARGS_A) },
      created_at: '2026-07-23T00:00:00.000Z',
    };
    setupTurn([], [completedMsg]);

    expect(screen.queryByLabelText('Waiting for your input')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Option A1')).not.toBeInTheDocument();
  });
});

describe('ClarifyDetailCard with a pending user input', () => {
  it('renders a read-only waiting summary, NOT the interactive form (that lives in the panel)', () => {
    const store = makeStore();
    store.dispatch(loadConversation({
      conversation: {
        _id: 'c1', conversationID: 1, log_index: 0, messages: [], executionState: 'EXECUTING',
        pending_tool_calls: [makePendingClarify('tc_a', 'uid_a', ARGS_A)] as never,
        streamedCompletedToolCalls: [], streamedThinking: '', version: 3,
      } as never,
      setAsActive: false,
    }));

    renderWithProviders(
      <ClarifyDetailCard msg={makePendingToolMsg('tc_a', ARGS_A) as never} filesDict={{}} />,
      { store },
    );

    // No interactive option buttons in the carousel card
    expect(screen.queryByLabelText('Option A1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Submit clarification')).not.toBeInTheDocument();
    // Read-only summary instead
    expect(screen.getByLabelText('Clarification waiting for response')).toBeInTheDocument();
  });
});
