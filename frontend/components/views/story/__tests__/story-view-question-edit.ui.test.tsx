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

describe('StoryView — question edit write-back (legacy html body)', () => {
  it('stages the viz override on the right saved-placeholder occurrence', () => {
    renderStory();
    const props = h.editorProps.at(-1)!;
    (props.onApplySavedViz as (req: unknown, viz: VizEnvelope) => void)(
      { kind: 'saved', questionId: 42, vizOverride: null, ref: { format: 'html', occurrence: 1 } },
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
      { kind: 'inline', embed: inlineEmbed, ref: { format: 'html', occurrence: 0 } },
      edited,
    );
    expect(h.staged).toHaveLength(1);
    const embeds = extractInlineQuestions(h.staged[0].story);
    // the projection's default table envelope is omitted on the way back — viz-less stays viz-less
    expect(embeds).toEqual([{ query: 'SELECT 2', connection: 'duckdb', height: '250px' }]);
  });
});

// Paths: div=0 → [h1=0.0, saved Question=0.1, inline Question=0.2]
const JSX_STORY = '<div className="s"><h1>T</h1><Question id={42} height="500px" /><Question query={`SELECT 1`} connection="duckdb" height="250px" /></div>';

function renderJsxStory() {
  return renderWithProviders(
    <StoryView
      content={{ description: null, story: JSX_STORY, format: 'jsx' } as StoryContent}
      fileId={9}
      headerEditMode
      storyPath="/org/reports/growth"
      storyName="Growth"
      colorMode="light"
    />,
  );
}

describe('StoryView — question edit write-back (jsx body)', () => {
  it('stages the viz override on the <Question> at the AST path', () => {
    renderJsxStory();
    const props = h.editorProps.at(-1)!;
    (props.onApplySavedViz as (req: unknown, viz: VizEnvelope) => void)(
      { kind: 'saved', questionId: 42, vizOverride: null, ref: { format: 'jsx', astPath: '0.1' } },
      OVERRIDE,
    );
    expect(h.staged).toHaveLength(1);
    const story = h.staged[0].story;
    expect(story).toContain('id={42}');
    expect(story).toContain('"version":2'); // the envelope landed as a viz attr
    expect(story).toContain('height="500px"'); // sizing preserved
  });

  it('replaces the inline <Question> at the AST path with the edited content', () => {
    renderJsxStory();
    const props = h.editorProps.at(-1)!;
    const edited = inlineEmbedToQuestionContent({ query: 'SELECT 2', connection: 'duckdb', height: '250px' });
    (props.onApplyInline as (req: unknown, content: unknown) => void)(
      { kind: 'inline', embed: { query: 'SELECT 1', connection: 'duckdb', height: '250px' }, ref: { format: 'jsx', astPath: '0.2' } },
      edited,
    );
    expect(h.staged).toHaveLength(1);
    const story = h.staged[0].story;
    expect(story).toContain('SELECT 2');
    expect(story).not.toContain('SELECT 1');
    expect(story).toContain('id={42}'); // the saved embed is untouched
  });
});
