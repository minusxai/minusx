/**
 * StoryQuestionEditor — the story-level host for editing question embeds in a modal.
 * - kind:'saved' → wraps CreateQuestionModalContainer on the REAL file; with a viz override it
 *   opens in 'saved-override' mode (viz edits go back to the story, not the file).
 * - kind:'inline' → creates a THROWAWAY draft seeded with the embed's content and opens the modal
 *   in 'ephemeral' mode; Update hands the content back for the story body.
 * CreateQuestionModalContainer is mocked — the mode/lifecycle wiring is under test.
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { VizEnvelope, QuestionContent } from '@/lib/validation/atlas-schemas';
import type { InlineQuestionEmbed } from '@/lib/data/story/story-question';
import { inlineEmbedToQuestionContent } from '@/lib/data/story/story-question';

const h = vi.hoisted(() => ({
  modalProps: [] as Record<string, unknown>[],
  drafts: [] as { type: string; opts: Record<string, unknown> }[],
  edits: [] as Record<string, unknown>[],
}));

vi.mock('@/components/modals/CreateQuestionModalContainer', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    h.modalProps.push(props);
    return React.createElement('div', { 'aria-label': 'Question modal' });
  };
  return { __esModule: true, default: Fake };
});

vi.mock('@/lib/file-state/file-state', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createDraftFile: vi.fn(async (type: string, opts: Record<string, unknown>) => {
    h.drafts.push({ type, opts });
    return 777;
  }),
  editFile: vi.fn((args: Record<string, unknown>) => { h.edits.push(args); return { success: true }; }),
}));

import StoryQuestionEditor from '../StoryQuestionEditor';

const OVERRIDE: VizEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: '.mx-th{background:#111}' },
};

beforeEach(() => {
  h.modalProps.length = 0;
  h.drafts.length = 0;
  h.edits.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('StoryQuestionEditor — saved embeds', () => {
  it('opens the modal on the real file in saved-override mode when the embed has an override', async () => {
    const onApplySavedViz = vi.fn();
    const req = { kind: 'saved' as const, questionId: 42, vizOverride: OVERRIDE, ref: { format: 'html' as const, occurrence: 1 } };
    renderWithProviders(
      <StoryQuestionEditor
        request={req}
        storyPath="/org/reports/growth-story"
        onClose={vi.fn()}
        onApplySavedViz={onApplySavedViz}
        onApplyInline={vi.fn()}
      />,
    );
    await screen.findByLabelText('Question modal');
    const props = h.modalProps.at(-1)!;
    expect(props.questionId).toBe(42);
    expect(props.storyEmbedMode).toBe('saved-override');
    expect(props.sourceBadge).toBe('saved');
    expect(props.vizOverride).toEqual(OVERRIDE);
    expect(props.isNewQuestion).toBe(false);
    // the modal hands an edited override back → forwarded with the request (occurrence intact)
    (props.onApplyVizOverride as (v: VizEnvelope) => void)(OVERRIDE);
    expect(onApplySavedViz).toHaveBeenCalledWith(req, OVERRIDE);
  });

  it('opens id-only embeds WITHOUT override mode (dashboard semantics: viz edits go to the file)', async () => {
    renderWithProviders(
      <StoryQuestionEditor
        request={{ kind: 'saved', questionId: 7, vizOverride: null, ref: { format: 'html', occurrence: 0 } }}
        onClose={vi.fn()}
        onApplySavedViz={vi.fn()}
        onApplyInline={vi.fn()}
      />,
    );
    await screen.findByLabelText('Question modal');
    const props = h.modalProps.at(-1)!;
    expect(props.questionId).toBe(7);
    expect(props.storyEmbedMode).toBeUndefined();
    expect(props.sourceBadge).toBe('saved');
  });
});

describe('StoryQuestionEditor — inline (ephemeral) embeds', () => {
  const embed: InlineQuestionEmbed = { query: 'SELECT 1', connection: 'duckdb', viz: OVERRIDE, height: '250px' };

  it('creates a draft seeded with the embed content and opens the modal in ephemeral mode', async () => {
    const onApplyInline = vi.fn();
    const req = { kind: 'inline' as const, embed, ref: { format: 'html' as const, occurrence: 2 } };
    renderWithProviders(
      <StoryQuestionEditor
        request={req}
        storyPath="/org/reports/growth-story"
        onClose={vi.fn()}
        onApplySavedViz={vi.fn()}
        onApplyInline={onApplyInline}
      />,
    );
    await screen.findByLabelText('Question modal');
    // draft created in the story's folder, seeded with the embed's projected content
    expect(h.drafts).toEqual([{ type: 'question', opts: { folder: '/org/reports' } }]);
    await waitFor(() => expect(h.edits.length).toBeGreaterThan(0));
    expect(h.edits[0]).toEqual({ fileId: 777, changes: { content: inlineEmbedToQuestionContent(embed) } });
    const props = h.modalProps.at(-1)!;
    expect(props.questionId).toBe(777);
    expect(props.storyEmbedMode).toBe('ephemeral');
    expect(props.sourceBadge).toBe('ephemeral');
    // the modal hands edited content back → forwarded with the request
    const edited = inlineEmbedToQuestionContent({ ...embed, query: 'SELECT 2' }) as QuestionContent;
    (props.onEphemeralApply as (c: QuestionContent) => void)(edited);
    expect(onApplyInline).toHaveBeenCalledWith(req, edited);
  });

  it('renders nothing when there is no request', () => {
    renderWithProviders(
      <StoryQuestionEditor
        request={null}
        onClose={vi.fn()}
        onApplySavedViz={vi.fn()}
        onApplyInline={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Question modal')).toBeNull();
  });
});
