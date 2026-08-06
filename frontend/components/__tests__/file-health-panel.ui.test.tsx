/**
 * FileHealthBadge UI test — the health badge computes the deterministic rubric client-side
 * from Redux content and opens a panel with deterministic findings.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { setFile, setEdit } from '@/store/filesSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { FileHealthBadge } from '@/components/file-browser/FileHealthPanel';
import type { DbFile } from '@/lib/types';

// The badge initializes the screenshot hook even though all visual-review actions are currently
// hidden; stub its browser-only rasterizer for jsdom.
vi.mock('@/lib/hooks/useScreenshot', () => ({
  useScreenshot: () => ({
    captureFileView: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' })),
    blobToDataURL: vi.fn().mockResolvedValue('data:image/jpeg;base64,AAA'),
  }),
}));

function seedQuestion(store: ReturnType<typeof makeStore>, id: number, content: unknown) {
  store.dispatch(setFile({ file: { id, name: 'q', path: '/org/q', type: 'question', content } as unknown as DbFile }));
}

describe('FileHealthBadge', () => {
  it('does not offer a visual-review action while every LLM checklist is paused', async () => {
    const store = makeStore();
    seedQuestion(store, 40, { description: 'saved desc', query: 'SELECT 1', vizSettings: { type: 'table' }, parameters: [], connection_name: 'w' });
    renderWithProviders(<FileHealthBadge fileId={40} fileType="question" />, { store });
    await userEvent.click(await screen.findByLabelText(/File health:/));
    expect(screen.queryByLabelText('Run visual review with the LLM judge')).toBeNull();
    expect(screen.queryByLabelText(/structural checks only/i)).toBeNull();
  });


  it('shows a health badge for a question with its overall score', async () => {
    const store = makeStore();
    seedQuestion(store, 1, { description: 'ok', query: 'SELECT 1', vizSettings: { type: 'table' }, parameters: [], connection_name: 'w' });
    renderWithProviders(<FileHealthBadge fileId={1} fileType="question" />, { store });

    const badge = await screen.findByLabelText(/File health:/);
    expect(badge.getAttribute('aria-label')).toContain('of 5');
    expect(badge.getAttribute('aria-label')).toContain('good'); // clean question
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
    expect(badge.getAttribute('aria-label')).toContain('0 of 5 (poor)'); // embed-too-narrow is an error — the gate zeroes the overall
  });

  it('does not flag the same story when the referenced question viz types are unknown', async () => {
    const store = makeStore();
    seedStory(store, 11); // referenced questions 21-23 NOT in the store → viz types unknown
    renderWithProviders(<FileHealthBadge fileId={11} fileType="story" />, { store });
    const badge = await screen.findByLabelText(/File health:/);
    expect(badge.getAttribute('aria-label')).toContain('5 of 5');
  });

  // A DRAFT's saved content is the empty template — grading it reads "no live evidence → 0/5"
  // while a full story is visibly on screen (the agent's staged build). For drafts the badge must
  // grade the MERGED (staged) content; published files keep the cheap saved-content scoring.
  it('grades a draft story on its staged content, not the empty saved template', async () => {
    const store = makeStore();
    store.dispatch(setFile({ file: {
      id: 12, name: '', path: '/tutorial/x', type: 'story', draft: true,
      content: { description: '', story: '', suggestedQuestions: null, colorMode: null, parameterValues: null },
    } as unknown as DbFile }));
    // The agent stages a healthy story body (gutter, headline, live embed, tokens).
    store.dispatch(setEdit({ fileId: 12, edits: {
      description: 'Orders grew 6.2% month over month.',
      story: `<style>{\`.s{font-family:Inter;color:#111;background:#fff;padding:0 48px} h1{color:#2563eb} .a{color:#f59e0b}\`}</style><div class="s"><h1>Orders grew 6.2%</h1><Question id={21} height="430px" /></div>`,
    } }));
    renderWithProviders(<FileHealthBadge fileId={12} fileType="story" />, { store });
    const badge = await screen.findByLabelText(/File health:/);
    expect(badge.getAttribute('aria-label')).not.toContain('0 of 5'); // no bogus "no live evidence" gate
  });
});
