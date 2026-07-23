/**
 * InlineNumber footnote chrome — SELF-CONTAINED styling contract (staging regression, Jul 2026).
 *
 * The footnote popover renders INSIDE the story iframe, whose only stylesheet is the compiled
 * story CSS — Chakra/emotion recipe classes never reach it (Renderer_v2 §6a mirror shrink). So
 * the popover surface, the source-chart frame, and the Edit-query trigger must be styled with
 * Tailwind token classes (compiled in via EMBED_CHROME_FILES), never Chakra style props:
 * a Chakra `width="420px"` / `height="260px"` resolves to NOTHING in the iframe and the
 * footnote renders as an unstyled transparent block with a collapsed chart.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true, default: () => React.createElement('div', { 'aria-label': 'saved chart' }),
}));
vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true, default: () => React.createElement('div', { 'aria-label': 'inline chart' }),
}));
vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFile: () => ({}),
  useQueryResult: () => ({ data: { columns: ['v'], rows: [{ v: 42 }] } }),
}));

import InlineNumber from '../InlineNumber';

const QUERY = 'SELECT SUM(mrr) AS v FROM t';

describe('InlineNumber footnote — token-class chrome (no emotion channel)', () => {
  it('the popover surface carries the footnote card classes, not Chakra props', async () => {
    renderWithProviders(<InlineNumber embed={{ query: QUERY, connection: 'duck', col: 'v' }} />);
    fireEvent.click(screen.getByLabelText(/^live number/));
    const content = await screen.findByLabelText('Number footnote');
    // Popover.Content stays a Chakra/ark component (its POSITIONING against the iframe document
    // is the behavior we keep), so it also carries an inert recipe `css-*` class — harmless in
    // the iframe, where no emotion rule resolves. The contract is that the FULL visual comes
    // from the token classes below, which the compiled story CSS carries.
    for (const c of ['w-[420px]', 'max-w-[90vw]', 'bg-popover', 'border-border', 'rounded-md']) {
      expect(content.className).toContain(c);
    }
  });

  it('a saved number frames its source chart at a fixed token-class height', async () => {
    renderWithProviders(<InlineNumber embed={{ id: 7 }} />);
    fireEvent.click(screen.getByLabelText(/^live number/));
    await waitFor(() => expect(screen.getByLabelText('saved chart')).toBeInTheDocument());
    const frame = screen.getByLabelText('saved chart').parentElement as HTMLElement;
    for (const c of ['h-[260px]', 'overflow-hidden']) expect(frame.className).toContain(c);
    expect(frame.className).not.toMatch(/\bcss-/);
  });

  it('the Edit-query trigger is a styled plain button (no Chakra recipe)', async () => {
    renderWithProviders(
      <InlineNumber embed={{ query: QUERY, connection: 'duck', col: 'v' }} editable onRequestEdit={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText(/^live number/));
    const btn = await screen.findByLabelText('edit inline number query');
    expect(btn.className).not.toMatch(/\bcss-/);
    expect(btn.className).toContain('border-border');
  });
});
