/**
 * The <Number> footnote popover shows the SOURCE QUERY (so a figure is auditable), and in the
 * story's EDIT mode the inline query is editable — Apply hands the new query up via onEmbedChange
 * (AgentHtml writes it back to the body placeholder + re-renders). Chart containers + the query
 * hook are mocked so we render InlineNumber directly and assert the popover contents.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true, default: () => React.createElement('div', { 'aria-label': 'inline chart' }),
}));
vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true, default: () => React.createElement('div', { 'aria-label': 'saved chart' }),
}));
vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFile: () => ({}),
  useQueryResult: () => ({ data: { columns: ['v'], rows: [{ v: 42 }] } }),
}));

import InlineNumber from '../InlineNumber';

const QUERY = 'SELECT SUM(mrr) AS v FROM t WHERE mrr >= :min_mrr';

describe('InlineNumber footnote — source query (read + edit)', () => {
  it('shows the inline query (read-only) in the popover', async () => {
    renderWithProviders(<InlineNumber embed={{ query: QUERY, connection: 'duck', col: 'v' }} />);
    fireEvent.click(screen.getByLabelText(/^live number/));
    await waitFor(() => {
      const q = screen.getByLabelText('inline number query');
      expect(q.tagName).toBe('PRE');           // read-only, not editable
      expect(q.textContent).toBe(QUERY);
    });
  });

  it('in EDIT mode the query is a textarea; Apply emits the edited query', async () => {
    const onEmbedChange = vi.fn();
    renderWithProviders(
      <InlineNumber embed={{ query: QUERY, connection: 'duck', col: 'v' }} editable onEmbedChange={onEmbedChange} />,
    );
    fireEvent.click(screen.getByLabelText(/^live number/));
    const box = await screen.findByLabelText('inline number query');
    expect((box as HTMLTextAreaElement).tagName).toBe('TEXTAREA');

    const next = QUERY + ' AND region = :region';
    fireEvent.change(box, { target: { value: next } });
    fireEvent.click(screen.getByLabelText('apply inline number query'));
    expect(onEmbedChange).toHaveBeenCalledWith({ query: next, connection: 'duck', col: 'v' });
  });

  it('a saved <Number id> shows its query read-only (no edit affordance even in edit mode)', async () => {
    // SavedNumber has no query of its own here (the mocked hook returns no content), so it simply
    // shows the chart; editing a saved question belongs on the question file. Assert no Apply button.
    renderWithProviders(<InlineNumber embed={{ id: 7 }} editable onEmbedChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/^live number/));
    await waitFor(() => expect(screen.getByLabelText('saved chart')).toBeInTheDocument());
    expect(screen.queryByLabelText('apply inline number query')).toBeNull();
  });
});
