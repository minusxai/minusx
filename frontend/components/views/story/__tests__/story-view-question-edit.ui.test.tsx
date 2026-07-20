/**
 * StoryView — question-modal write-back glue. When StoryQuestionEditor applies an edit, StoryView
 * must stage the pure story-HTML transform on the file via applyStoryHtmlEdit:
 * - a saved embed's viz override lands on (only) the right placeholder occurrence;
 * - an inline embed is replaced wholesale (content → embed reverse-projection, height preserved).
 * StoryQuestionEditor + file-state are mocked; the transform-and-stage glue is under test.
 */
import React from 'react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { StoryContent } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import {
  savedQuestionToPlaceholder, inlineQuestionToPlaceholder, inlineEmbedToQuestionContent,
  extractInlineQuestions, type InlineQuestionEmbed,
} from '@/lib/data/story/story-question';

const h = vi.hoisted(() => ({
  editorProps: [] as Record<string, unknown>[],
  staged: [] as { fileId: number; story: string }[],
}));

vi.mock('@/components/views/story/StoryQuestionEditor', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    h.editorProps.push(props);
    return React.createElement('div', { 'aria-label': 'Story question editor' });
  };
  return { __esModule: true, default: Fake };
});

vi.mock('@/lib/file-state/file-state', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  applyStoryHtmlEdit: vi.fn((args: { fileId: number; story: string }) => {
    h.staged.push(args);
    return { success: true };
  }),
}));

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'aria-label': 'Embedded question' }),
}));
vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'aria-label': 'Inline embed' }),
}));

import StoryView from '@/components/views/story/StoryView';

const OVERRIDE: VizEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: '.mx-th{background:#111}' },
};

const inlineEmbed: InlineQuestionEmbed = { query: 'SELECT 1', connection: 'duckdb', height: '250px' };

const STORY =
  '<div class="s"><h1>T</h1>' +
  savedQuestionToPlaceholder(42) +
  savedQuestionToPlaceholder(42, '300px') +
  inlineQuestionToPlaceholder(inlineEmbed) +
  '</div>';

const content: StoryContent = { description: null, story: STORY };

function renderStory() {
  return renderWithProviders(
    <StoryView
      content={content}
      fileId={9}
      headerEditMode
      storyPath="/org/reports/growth"
      storyName="Growth"
      colorMode="light"
    />,
  );
}

beforeEach(() => {
  h.editorProps.length = 0;
  h.staged.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('StoryView — question edit write-back', () => {
  it('stages the viz override on the right saved-placeholder occurrence', () => {
    renderStory();
    const props = h.editorProps.at(-1)!;
    (props.onApplySavedViz as (req: unknown, viz: VizEnvelope) => void)(
      { kind: 'saved', questionId: 42, occurrence: 1, vizOverride: null },
      OVERRIDE,
    );
    expect(h.staged).toHaveLength(1);
    expect(h.staged[0].fileId).toBe(9);
    const story = h.staged[0].story;
    expect(story.match(/data-question-viz=/g)).toHaveLength(1);
    // the second 42 placeholder (height 300px) got it; the first is untouched
    expect(story.indexOf('data-question-viz=')).toBeGreaterThan(story.indexOf('height:430px'));
    expect(story).toContain('height:300px');
  });

  it('replaces the inline embed with the edited content (height preserved)', () => {
    renderStory();
    const props = h.editorProps.at(-1)!;
    const edited = inlineEmbedToQuestionContent({ ...inlineEmbed, query: 'SELECT 2' });
    (props.onApplyInline as (req: unknown, content: unknown) => void)(
      { kind: 'inline', index: 0, embed: inlineEmbed },
      edited,
    );
    expect(h.staged).toHaveLength(1);
    const embeds = extractInlineQuestions(h.staged[0].story);
    // the projection's default table envelope is omitted on the way back — viz-less stays viz-less
    expect(embeds).toEqual([{ query: 'SELECT 2', connection: 'duckdb', height: '250px' }]);
  });
});
