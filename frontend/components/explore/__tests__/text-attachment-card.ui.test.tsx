/**
 * TextAttachmentCard — renders a text attachment (e.g. a selection snippet) as a
 * compact, expandable chip in the chat transcript. Queries use aria-labels only.
 */

import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import TextAttachmentCard from '@/components/explore/TextAttachmentCard';
import type { Attachment } from '@/lib/types';

const ATT: Attachment = {
  type: 'text',
  name: 'Selection from Revenue (SQL, lines 3–5) [/org/Revenue]',
  content: 'SELECT id\nFROM orders\nWHERE x = 1',
  metadata: { language: 'sql', sourceLabel: 'Revenue' },
};

describe('TextAttachmentCard', () => {
  it('shows a compact chip with line count and source label', async () => {
    renderWithProviders(<TextAttachmentCard attachment={ATT} />);
    const chip = await screen.findByLabelText('Selected snippet: Revenue');
    expect(chip).toHaveTextContent('3 lines');
    expect(chip).toHaveTextContent('Revenue');
  });

  it('expands to reveal the snippet content on click, and collapses again', async () => {
    renderWithProviders(<TextAttachmentCard attachment={ATT} />);
    expect(screen.queryByLabelText('Snippet content')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByLabelText('Selected snippet: Revenue'));
    expect(await screen.findByLabelText('Snippet content')).toHaveTextContent('SELECT id');

    fireEvent.click(await screen.findByLabelText('Selected snippet: Revenue'));
    expect(screen.queryByLabelText('Snippet content')).not.toBeInTheDocument();
  });

  it('uses a singular label for a one-line snippet and falls back to the name', async () => {
    const att: Attachment = { type: 'text', name: 'notes.txt', content: 'just one line' };
    renderWithProviders(<TextAttachmentCard attachment={att} />);
    const chip = await screen.findByLabelText('Selected snippet: notes.txt');
    expect(chip).toHaveTextContent('1 line');
  });
});
