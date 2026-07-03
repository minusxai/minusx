/**
 * FileHealthBadge UI test — the health badge computes the deterministic rubric client-side
 * from Redux content, and opens a panel with findings + a visual-review action.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { FileHealthBadge } from '@/components/FileHealthPanel';
import type { DbFile } from '@/lib/types';

function seedQuestion(store: ReturnType<typeof makeStore>, id: number, content: unknown) {
  store.dispatch(setFile({ file: { id, name: 'q', path: '/org/q', type: 'question', content } as unknown as DbFile }));
}

describe('FileHealthBadge', () => {
  it('shows a health badge for a question with its overall score', async () => {
    const store = makeStore();
    seedQuestion(store, 1, { description: 'ok', query: 'SELECT 1', vizSettings: { type: 'table' }, parameters: [], connection_name: 'w' });
    renderWithProviders(<FileHealthBadge fileId={1} fileType="question" />, { store });

    const badge = await screen.findByLabelText(/File health:/);
    expect(badge.getAttribute('aria-label')).toContain('of 5');
    expect(badge.getAttribute('aria-label')).toContain('good'); // clean question
  });

  it('opens a panel with the visual-review action', async () => {
    const store = makeStore();
    // Unhealthy: :start referenced but undeclared → a correctness finding.
    seedQuestion(store, 2, { description: '', query: 'SELECT * FROM t WHERE d > :start', vizSettings: { type: 'table' }, parameters: [], connection_name: 'w' });
    renderWithProviders(<FileHealthBadge fileId={2} fileType="question" />, { store });

    await userEvent.click(await screen.findByLabelText(/File health:/));
    await waitFor(async () => {
      expect(await screen.findByLabelText('Run visual review with the LLM judge')).toBeTruthy();
    });
  });

  it('renders nothing for a non-scored file type', () => {
    const store = makeStore();
    renderWithProviders(<FileHealthBadge fileId={3} fileType="folder" />, { store });
    expect(screen.queryByLabelText(/File health:/)).toBeNull();
  });

  // A story's saved-embed chart types live on the referenced question files, not in the story
  // content — the badge must resolve them from Redux so `embed-too-narrow` can fire on packed grids.
  const STYLE = '<style>.s{font-family:Inter;color:#111} h1{color:#2563eb} .a{color:#f59e0b} .g{display:grid;grid-template-columns:repeat(3,1fr)}</style>';
  const narrowStory = {
    description: 'Revenue overview.',
    story: `<div class="s">${STYLE}<h1>T</h1><div class="g"><div data-question-id="21" style="width:100%;height:430px"></div><div data-question-id="22" style="width:100%;height:430px"></div><div data-question-id="23" style="width:100%;height:430px"></div></div></div>`,
    suggestedQuestions: null, colorMode: null, parameterValues: null,
  };
  const seedStory = (store: ReturnType<typeof makeStore>, id: number) =>
    store.dispatch(setFile({ file: { id, name: 's', path: '/org/s', type: 'story', content: narrowStory } as unknown as DbFile }));

  it('flags a story with cartesian charts packed into a 3-col grid, using referenced question viz types', async () => {
    const store = makeStore();
    seedStory(store, 10);
    for (const qid of [21, 22, 23]) seedQuestion(store, qid, { description: 'x', query: 'SELECT 1', vizSettings: { type: 'bar' }, parameters: [], connection_name: 'w' });
    renderWithProviders(<FileHealthBadge fileId={10} fileType="story" />, { store });
    const badge = await screen.findByLabelText(/File health:/);
    expect(badge.getAttribute('aria-label')).toContain('4 of 5'); // clarity -3 (error) for embed-too-narrow
  });

  it('does not flag the same story when the referenced question viz types are unknown', async () => {
    const store = makeStore();
    seedStory(store, 11); // referenced questions 21-23 NOT in the store → viz types unknown
    renderWithProviders(<FileHealthBadge fileId={11} fileType="story" />, { store });
    const badge = await screen.findByLabelText(/File health:/);
    expect(badge.getAttribute('aria-label')).toContain('5 of 5');
  });
});
