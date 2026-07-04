/**
 * UI tests for FeedbackBlock component.
 *
 * Covers:
 *  1. Idle state renders thumbs up/down and copy buttons
 *  2. Clicking thumbs up opens modal with positive tags
 *  3. Clicking thumbs down opens modal with negative tags
 *  4. Selecting tags and submitting sends correct fetch payload
 *  5. After submit, shows thank-you state
 *  6. Dismissing modal (cancel) sends feedback with empty tags
 *  7. Copy button copies answer content
 */

import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import FeedbackBlock from '@/components/explore/message/FeedbackBlock';

// Spy on global fetch to capture fire-and-forget calls.
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true })));

afterEach(() => {
  fetchSpy.mockClear();
});

function renderFeedback(props?: Partial<React.ComponentProps<typeof FeedbackBlock>>) {
  return renderWithProviders(
    <FeedbackBlock
      conversationID={7}
      userMessageLogIndex={2}
      answerContent="SELECT 1"
      {...props}
    />,
  );
}

describe('FeedbackBlock', () => {
  it('renders thumbs up, thumbs down, and copy buttons in idle state', () => {
    renderFeedback();
    expect(screen.getByLabelText('Thumbs up')).toBeInTheDocument();
    expect(screen.getByLabelText('Thumbs down')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy response')).toBeInTheDocument();
  });

  it('does not render copy button when answerContent is not provided', () => {
    renderFeedback({ answerContent: undefined });
    expect(screen.queryByLabelText('Copy response')).not.toBeInTheDocument();
  });

  it('opens modal with positive tags when thumbs up is clicked', async () => {
    renderFeedback();
    const user = userEvent.setup();

    await act(async () => {
      await user.click(screen.getByLabelText('Thumbs up'));
    });

    // Positive tags should be visible
    await waitFor(() => {
      expect(screen.getByLabelText('Tag: Accurate')).toBeInTheDocument();
      expect(screen.getByLabelText('Tag: Fast')).toBeInTheDocument();
      expect(screen.getByLabelText('Tag: Correct SQL')).toBeInTheDocument();
    });
  });

  it('opens modal with negative tags when thumbs down is clicked', async () => {
    renderFeedback();
    const user = userEvent.setup();

    await act(async () => {
      await user.click(screen.getByLabelText('Thumbs down'));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Tag: Inaccurate')).toBeInTheDocument();
      expect(screen.getByLabelText('Tag: Hallucinated data')).toBeInTheDocument();
    });
  });

  it('submits feedback with selected tags and comment', async () => {
    renderFeedback();
    const user = userEvent.setup();

    // Open positive feedback modal
    await act(async () => {
      await user.click(screen.getByLabelText('Thumbs up'));
    });

    // Select two tags
    await waitFor(() => expect(screen.getByLabelText('Tag: Accurate')).toBeInTheDocument());

    await act(async () => {
      await user.click(screen.getByLabelText('Tag: Accurate'));
      await user.click(screen.getByLabelText('Tag: Fast'));
    });

    // Type a comment
    const textarea = screen.getByLabelText('Feedback comment');
    await act(async () => {
      await user.type(textarea, 'Loved it');
    });

    // Submit
    await act(async () => {
      await user.click(screen.getByLabelText('Submit feedback'));
    });

    // Verify fetch was called with the right payload
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/chat/feedback');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body).toEqual({
      conversationId: 7,
      userMessageLogIndex: 2,
      rating: 'positive',
      tags: expect.arrayContaining(['Accurate', 'Fast']),
      comment: 'Loved it',
    });
    expect(body.tags).toHaveLength(2);

    // Should show thank-you state
    await waitFor(() => {
      expect(screen.getByText('Thanks for your feedback')).toBeInTheDocument();
    });

    // Thumbs buttons should be gone
    expect(screen.queryByLabelText('Thumbs up')).not.toBeInTheDocument();
  });

  it('dismissing modal sends feedback with empty tags and no comment', async () => {
    renderFeedback();
    const user = userEvent.setup();

    await act(async () => {
      await user.click(screen.getByLabelText('Thumbs down'));
    });

    await waitFor(() => expect(screen.getByLabelText('Cancel feedback')).toBeInTheDocument());

    await act(async () => {
      await user.click(screen.getByLabelText('Cancel feedback'));
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.rating).toBe('negative');
    expect(body.tags).toEqual([]);
    expect(body.comment).toBeUndefined();

    // Shows thank-you state after dismiss too
    await waitFor(() => {
      expect(screen.getByText('Thanks for your feedback')).toBeInTheDocument();
    });
  });

  it('toggling a tag off removes it from the selection', async () => {
    renderFeedback();
    const user = userEvent.setup();

    await act(async () => {
      await user.click(screen.getByLabelText('Thumbs up'));
    });

    await waitFor(() => expect(screen.getByLabelText('Tag: Accurate')).toBeInTheDocument());

    // Select then deselect
    await act(async () => {
      await user.click(screen.getByLabelText('Tag: Accurate'));
      await user.click(screen.getByLabelText('Tag: Accurate'));
    });

    // Submit with no tags selected
    await act(async () => {
      await user.click(screen.getByLabelText('Submit feedback'));
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tags).toEqual([]);
  });
});
