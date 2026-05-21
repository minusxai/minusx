import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { createConversation, setActiveConversation } from '@/store/chatSlice';
import SimpleChatMessage from '@/components/explore/SimpleChatMessage';

// Regression: clicking a suggested-question chip used to silently no-op.
// The reply is a COMPLETED chat tool call, so ToolCallDisplay's
// makeSelectConversationByToolCallId lookup (which only matches *pending* tool
// calls) returned undefined, and SuggestedQuestionsBlock fell back to the global
// selectActiveConversation — undefined for a non-active conversation. The fix
// threads the viewed conversationID: SimpleChatMessage → ToolCallDisplay →
// ContentDisplay → Markdown → SuggestedQuestionsBlock.
describe('Suggested question chips (full reply render path)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });

  it('sends the question to the viewed conversation even when it is not the active one and the tool call is completed (not pending)', async () => {
    const store = makeStore();
    // Viewed conversation exists, is NOT active, and has NO pending tool calls.
    store.dispatch(createConversation({ conversationID: 99, agent: 'AnalystAgent' }));
    store.dispatch(setActiveConversation(null));
    expect(store.getState().chat.conversations[99]?.active).toBe(false);
    expect(store.getState().chat.conversations[99]?.pending_tool_calls).toHaveLength(0);

    // A completed assistant reply, delivered as a TalkToUser chat tool message,
    // whose content carries a <suggested_questions> block.
    const replyMessage = {
      role: 'tool',
      tool_call_id: 'tc-reply-1',
      function: { name: 'TalkToUser', arguments: '{}' },
      content: JSON.stringify({
        content: 'Here is your answer.\n<suggested_questions><question>What is total revenue?</question></suggested_questions>',
      }),
    } as never;

    const { findByLabelText } = renderWithProviders(
      <SimpleChatMessage
        message={replyMessage}
        databaseName=""
        showThinking
        toggleShowThinking={() => {}}
        markdownContext="mainpage"
        viewMode="detailed"
        conversationID={99}
      />,
      { store },
    );

    const chip = await findByLabelText('Suggested question: What is total revenue?');
    fireEvent.click(chip);

    const conv = store.getState().chat.conversations[99];
    expect(conv.messages.some((m) => m.role === 'user' && m.content === 'What is total revenue?')).toBe(true);
  });
});
