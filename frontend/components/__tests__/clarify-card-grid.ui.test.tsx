/**
 * Phase 4 Layer A (Story_Design_V2 §6a): UserInputComponent card-grid branch.
 *
 * When any Clarify option carries an `imageUrl`, the choice UI renders image cards (preview on
 * top, label + check below) instead of the compact stacked rows. Selection semantics are
 * unchanged: single/multi select, "Other" (with text), "Figure it out", and Submit all keep
 * working, and the submitted result is the FULL option object (including `value`).
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { loadConversation } from '@/store/chatSlice';
import UserInputComponent from '@/components/explore/UserInputComponent';
import type { UserInputProps } from '@/lib/tools/user-input-exception';

const IMAGE_OPTIONS = [
  { label: 'Nocturne', description: 'dark-first, technical', value: 'nocturne', imageUrl: '/story-themes/nocturne.png' },
  { label: 'Organic', description: 'warm, soft, playful', value: 'organic', imageUrl: '/story-themes/organic.png' },
];

const PLAIN_OPTIONS = [{ label: 'Execs' }, { label: 'Team' }];

function setup(options: UserInputProps['options'], multiSelect = false) {
  const store = makeStore();
  const props: UserInputProps = {
    type: 'choice', title: 'Clarification needed', message: 'Pick a look',
    options, multiSelect, cancellable: true,
  };
  const userInput = { id: 'uid_1', props, result: undefined };
  store.dispatch(loadConversation({
    conversation: {
      _id: 'c1', conversationID: 1, log_index: 0, messages: [], executionState: 'EXECUTING',
      pending_tool_calls: [{
        toolCall: { id: 'tc_1', type: 'function' as const, function: { name: 'ClarifyFrontend', arguments: {} } },
        result: undefined,
        userInputs: [userInput],
      }] as never,
      streamedCompletedToolCalls: [], streamedThinking: '', version: 3,
    } as never,
    setAsActive: false,
  }));
  renderWithProviders(
    <UserInputComponent conversationID={1} tool_call_id="tc_1" userInput={userInput} toolName="ClarifyFrontend" />,
    { store },
  );
  return store;
}

const submittedResult = (store: ReturnType<typeof makeStore>) =>
  (store.getState().chat.conversations[1].pending_tool_calls[0] as any).userInputs[0].result;

describe('Clarify card grid (image options)', () => {
  it('renders preview images for options that carry imageUrl', () => {
    setup(IMAGE_OPTIONS);
    expect(screen.getByLabelText('Nocturne preview')).toBeInTheDocument();
    expect(screen.getByLabelText('Organic preview')).toBeInTheDocument();
    expect(screen.getByLabelText('Nocturne')).toBeInTheDocument();
    expect(screen.getByLabelText('Organic')).toBeInTheDocument();
  });

  it('selecting a card and submitting returns the full option including value', () => {
    const store = setup(IMAGE_OPTIONS);
    fireEvent.click(screen.getByLabelText('Nocturne'));
    fireEvent.click(screen.getByLabelText('Submit clarification'));
    expect(submittedResult(store)).toEqual(IMAGE_OPTIONS[0]);
  });

  it('single-select swaps the selection to the last clicked card', () => {
    const store = setup(IMAGE_OPTIONS);
    fireEvent.click(screen.getByLabelText('Nocturne'));
    fireEvent.click(screen.getByLabelText('Organic'));
    fireEvent.click(screen.getByLabelText('Submit clarification'));
    expect(submittedResult(store)).toEqual(IMAGE_OPTIONS[1]);
  });

  it('"Other" with custom text still works alongside image cards', () => {
    const store = setup(IMAGE_OPTIONS);
    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.change(screen.getByLabelText('Other response'), { target: { value: 'something brutalist' } });
    fireEvent.click(screen.getByLabelText('Submit clarification'));
    expect(submittedResult(store)).toEqual({ label: 'Other', other: true, text: 'something brutalist' });
  });

  it('"Figure it out" still works alongside image cards', () => {
    const store = setup(IMAGE_OPTIONS);
    fireEvent.click(screen.getByLabelText('Figure it out'));
    fireEvent.click(screen.getByLabelText('Submit clarification'));
    expect(submittedResult(store)).toEqual({ label: 'Figure it out', figureItOut: true });
  });

  it('multi-select returns every selected option', () => {
    const store = setup(IMAGE_OPTIONS, true);
    fireEvent.click(screen.getByLabelText('Nocturne'));
    fireEvent.click(screen.getByLabelText('Organic'));
    fireEvent.click(screen.getByLabelText('Submit clarification'));
    expect(submittedResult(store)).toEqual(IMAGE_OPTIONS);
  });

  it('options WITHOUT imageUrl keep the compact row layout (no preview images)', () => {
    setup(PLAIN_OPTIONS);
    expect(screen.getByLabelText('Execs')).toBeInTheDocument();
    expect(screen.queryByLabelText('Execs preview')).not.toBeInTheDocument();
  });
});
