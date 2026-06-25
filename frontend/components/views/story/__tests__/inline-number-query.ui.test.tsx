/**
 * The <Number> footnote popover shows the SOURCE QUERY (read-only, to trace the figure). In the
 * story's EDIT mode it offers an "Edit query" trigger that asks StoryView to open the full SqlEditor
 * in a light-DOM modal (Monaco's autocomplete can't live in the story shadow root). Chart containers
 * + the query hook are mocked so we render InlineNumber directly and assert the popover contents.
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

describe('InlineNumber footnote — source query (read) + Edit-query trigger', () => {
  it('shows the inline query read-only in the popover', async () => {
    renderWithProviders(<InlineNumber embed={{ query: QUERY, connection: 'duck', col: 'v' }} />);
    fireEvent.click(screen.getByLabelText(/^live number/));
    await waitFor(() => {
      const q = screen.getByLabelText('inline number query');
      expect(q.tagName).toBe('PRE');
      expect(q.textContent).toBe(QUERY);
    });
    // not editable → no Edit-query trigger
    expect(screen.queryByLabelText('edit inline number query')).toBeNull();
  });

  it('in EDIT mode offers "Edit query", which requests the editor (onRequestEdit)', async () => {
    const onRequestEdit = vi.fn();
    renderWithProviders(
      <InlineNumber embed={{ query: QUERY, connection: 'duck', col: 'v' }} editable onRequestEdit={onRequestEdit} />,
    );
    fireEvent.click(screen.getByLabelText(/^live number/));
    fireEvent.click(await screen.findByLabelText('edit inline number query'));
    expect(onRequestEdit).toHaveBeenCalledTimes(1);
  });

  it('a saved <Number id> shows its query read-only with NO edit trigger (even in edit mode)', async () => {
    renderWithProviders(<InlineNumber embed={{ id: 7 }} editable onRequestEdit={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/^live number/));
    await waitFor(() => expect(screen.getByLabelText('saved chart')).toBeInTheDocument());
    expect(screen.queryByLabelText('edit inline number query')).toBeNull();
  });
});
