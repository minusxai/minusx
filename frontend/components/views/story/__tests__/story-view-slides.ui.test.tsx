/**
 * StoryView + <SlideDeck> — the full pipeline: jsx source → interpreter (registry) →
 * iframe surface → slide discovery (useSlideNav's bounded poll) → birds-eye rail.
 * The rail must stay OUT of ordinary stories and out of edit mode.
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { StoryContent } from '@/lib/types';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'aria-label': 'Embedded question' }),
}));
vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'aria-label': 'Inline embed' }),
}));
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

import StoryView from '@/components/views/story/StoryView';

const DECK: StoryContent = {
  format: 'jsx',
  story: [
    '<SlideDeck>',
    '<Slide title="Cover"><h1>Retention pays</h1></Slide>',
    '<Slide><h2>Act one</h2></Slide>',
    '<Slide title="Close"><p>fin</p></Slide>',
    '</SlideDeck>',
  ].join('\n'),
} as StoryContent;

const PROSE: StoryContent = {
  format: 'jsx',
  story: '<div><h1>Just prose</h1><p>No deck here.</p></div>',
} as StoryContent;

describe('StoryView — slide chrome', () => {
  it('discovers the deck and renders the birds-eye rail with resolved titles', async () => {
    renderWithProviders(
      <StoryView content={DECK} fileId={1} headerEditMode={false} colorMode="light" />,
    );
    const rail = await screen.findByLabelText('Slide overview', {}, { timeout: 5000 });
    expect(rail).toBeTruthy();
    // Authored title, heading fallback, authored title again — slide-nav's resolution order.
    expect(screen.getByLabelText('Go to slide 1: Cover')).toBeTruthy();
    expect(screen.getByLabelText('Go to slide 2: Act one')).toBeTruthy();
    expect(screen.getByLabelText('Go to slide 3: Close')).toBeTruthy();
    // Rename is an edit-session affordance — absent while merely viewing.
    expect(screen.queryByLabelText('Edit slide 1 title')).toBeNull();
  });

  it('renders no rail for a story without slides', async () => {
    renderWithProviders(
      <StoryView content={PROSE} fileId={1} headerEditMode={false} colorMode="light" />,
    );
    // The story itself must render…
    await waitFor(() => {
      const canvas = screen.getByLabelText('Story canvas');
      expect(canvas.querySelector('iframe')).toBeTruthy();
    });
    // …and the rail must not (poll settles to empty — nothing to wait for beyond absence).
    expect(screen.queryByLabelText('Slide overview')).toBeNull();
  });

  it('keeps the rail during an edit session, with the rename affordance', async () => {
    renderWithProviders(
      <StoryView content={DECK} fileId={1} headerEditMode={true} colorMode="light" />,
    );
    const rail = await screen.findByLabelText('Slide overview', {}, { timeout: 5000 });
    expect(rail).toBeTruthy();
    expect(screen.getByLabelText('Edit slide 1 title')).toBeTruthy();
  });
});
