/**
 * DeckView (HTML slides) — thumbnail rail + stage + present mode over
 * deck: { id, html }[]. v0 is a viewer: no WYSIWYG; edit mode only allows
 * deleting slides. All element queries by aria-label per repo convention.
 */
import React from 'react';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ questionId }: { questionId: number }) =>
    React.createElement('div', { 'aria-label': `Embedded question ${questionId}` }),
}));

import DeckView from '@/components/views/deck/DeckView';

const DECK = [
  { id: 's1', html: '<h1>First slide</h1><div data-question-id="42"></div>' },
  { id: 's2', html: '<h1>Second slide</h1><div data-question-id="7"></div>' },
  { id: 's3', html: '<h1>Third slide</h1>' },
];

describe('DeckView', () => {
  it('shows the empty state when there are no slides', () => {
    renderWithProviders(<DeckView deck={[]} editMode={false} onChange={vi.fn()} />);
    expect(screen.getByLabelText('No slides')).toBeInTheDocument();
  });

  it('renders the first slide on the stage and one thumbnail per slide', async () => {
    renderWithProviders(<DeckView deck={DECK} editMode={false} onChange={vi.fn()} />);
    const stage = screen.getByLabelText('Slide stage');
    expect(stage.textContent).toContain('First slide');
    await within(stage).findByLabelText('Embedded question 42');
    expect(screen.getByLabelText('Slide 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Slide 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Slide 3')).toBeInTheDocument();
  });

  it('switches the stage when a thumbnail is clicked', async () => {
    renderWithProviders(<DeckView deck={DECK} editMode={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Slide 2'));
    const stage = screen.getByLabelText('Slide stage');
    expect(stage.textContent).toContain('Second slide');
    await within(stage).findByLabelText('Embedded question 7');
  });

  it('filters out legacy slides that have no html string', () => {
    const legacy = [
      { id: 'old', items: [{ id: 1, xPct: 0, yPct: 0, wPct: 10, hPct: 10 }] } as any,
      ...DECK,
    ];
    renderWithProviders(<DeckView deck={legacy} editMode={false} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Slide 3')).toBeInTheDocument();
    expect(screen.queryByLabelText('Slide 4')).toBeNull();
  });

  it('presents fullscreen with keyboard navigation', async () => {
    renderWithProviders(<DeckView deck={DECK} editMode={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Present'));
    const overlay = screen.getByLabelText('Presentation');
    expect(overlay.textContent).toContain('First slide');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByLabelText('Presentation').textContent).toContain('Second slide'));

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.getByLabelText('Presentation').textContent).toContain('First slide'));

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Presentation')).toBeNull());
  });

  it('deletes a slide in edit mode', () => {
    const onChange = vi.fn();
    renderWithProviders(<DeckView deck={DECK} editMode={true} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Delete slide 1'));
    expect(onChange).toHaveBeenCalledWith({ deck: [DECK[1], DECK[2]] });
  });

  it('hides delete buttons outside edit mode', () => {
    renderWithProviders(<DeckView deck={DECK} editMode={false} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('Delete slide 1')).toBeNull();
  });
});
