/**
 * StoryEmbeds — edit affordances for question embeds (story edit mode).
 * - saved embeds: the card's Edit action fires onEditQuestion with kind:'saved' + the embed's
 *   occurrence (nth placeholder with that id) + its story-level viz override;
 * - inline embeds: a pencil overlay (edit mode only) fires kind:'inline' with the raw embed.
 * The embed containers are mocked; the affordance wiring is under test.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { InlineQuestionEmbed } from '@/lib/data/story/story-question';
import { inlineEmbedToQuestionContent } from '@/lib/data/story/story-question';

const h = vi.hoisted(() => ({
  smartProps: [] as Record<string, unknown>[],
  paramProps: [] as Record<string, unknown>[],
}));

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    h.smartProps.push(props);
    return React.createElement('button', {
      'aria-label': `Edit saved ${props.questionId}-${h.smartProps.filter(p => p.questionId === props.questionId).length - 1}`,
      onClick: () => (props.onEdit as (() => void) | undefined)?.(),
    });
  };
  return { __esModule: true, default: Fake };
});

vi.mock('@/components/containers/EmbeddedQuestionContainer', async () => {
  const React = await import('react');
  return { __esModule: true, default: () => React.createElement('div', { 'aria-label': 'Inline embed body' }) };
});

vi.mock('@/components/views/story/StoryParamControl', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    h.paramProps.push(props);
    return React.createElement('button', {
      'aria-label': `Edit ${(props.param as { name: string }).name} options query`,
      onClick: () => (props.onRequestEdit as (() => void) | undefined)?.(),
    });
  };
  return { __esModule: true, default: Fake };
});

import StoryEmbeds from '../StoryEmbeds';

const OVERRIDE: VizEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: '.mx-th{background:#111}' },
};

const el = () => {
  const e = document.createElement('div');
  document.body.appendChild(e);
  return e;
};

beforeEach(() => {
  document.body.innerHTML = '';
  h.smartProps.length = 0;
  h.paramProps.length = 0;
});

describe('StoryEmbeds — question edit affordances', () => {
  it('saved embeds report kind:saved with per-id occurrence and the viz override', () => {
    const onEditQuestion = vi.fn();
    renderWithProviders(
      <StoryEmbeds
        doc={document}
        targets={[
          { el: el(), questionId: 42 },
          { el: el(), questionId: 7, vizOverride: OVERRIDE },
          { el: el(), questionId: 42, vizOverride: OVERRIDE },
        ]}
        inlineTargets={[]}
        numberTargets={[]}
        paramTargets={[]}
        readOnly={false}
        editable
        onEditQuestion={onEditQuestion}
      />,
    );
    fireEvent.click(screen.getByLabelText('Edit saved 42-1'));
    expect(onEditQuestion).toHaveBeenLastCalledWith({ kind: 'saved', questionId: 42, vizOverride: OVERRIDE, ref: { format: 'html', occurrence: 1 } });
    fireEvent.click(screen.getByLabelText('Edit saved 7-0'));
    expect(onEditQuestion).toHaveBeenLastCalledWith({ kind: 'saved', questionId: 7, vizOverride: OVERRIDE, ref: { format: 'html', occurrence: 0 } });
    fireEvent.click(screen.getByLabelText('Edit saved 42-0'));
    expect(onEditQuestion).toHaveBeenLastCalledWith({ kind: 'saved', questionId: 42, vizOverride: null, ref: { format: 'html', occurrence: 0 } });
  });

  it('inline embeds get the SAME "Card actions" menu as saved cards, with an Edit question item', async () => {
    const onEditQuestion = vi.fn();
    const embedA: InlineQuestionEmbed = { query: 'SELECT 1', connection: 'duckdb' };
    const embedB: InlineQuestionEmbed = { connection: '', spreadsheet: { version: 1, columns: [{ name: 'x', type: 'number' }], rows: [['1']] } };
    renderWithProviders(
      <StoryEmbeds
        doc={document}
        targets={[]}
        inlineTargets={[
          { el: el(), content: inlineEmbedToQuestionContent(embedA), embed: embedA },
          { el: el(), content: inlineEmbedToQuestionContent(embedB), embed: embedB },
        ]}
        numberTargets={[]}
        paramTargets={[]}
        readOnly={false}
        editable
        onEditQuestion={onEditQuestion}
      />,
    );
    // same affordance name as the saved-card menu (SmartEmbeddedQuestionContainer)
    const triggers = screen.getAllByLabelText('Card actions');
    expect(triggers).toHaveLength(2);
    fireEvent.click(triggers[1]);
    fireEvent.click(await screen.findByLabelText('Edit question'));
    expect(onEditQuestion).toHaveBeenLastCalledWith({ kind: 'inline', embed: embedB, ref: { format: 'html', occurrence: 1 } });
  });

  it('shows no inline actions menu outside edit mode', () => {
    const embedA: InlineQuestionEmbed = { query: 'SELECT 1', connection: 'duckdb' };
    renderWithProviders(
      <StoryEmbeds
        doc={document}
        targets={[]}
        inlineTargets={[{ el: el(), content: inlineEmbedToQuestionContent(embedA), embed: embedA }]}
        numberTargets={[]}
        paramTargets={[]}
        readOnly={false}
        editable={false}
        onEditQuestion={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Card actions')).toBeNull();
    expect(screen.queryByLabelText('Edit question')).toBeNull();
  });

  it('query-backed params report their legacy placeholder occurrence in edit mode', () => {
    const onEditParamQuery = vi.fn();
    renderWithProviders(
      <StoryEmbeds
        doc={document}
        targets={[]}
        inlineTargets={[]}
        numberTargets={[]}
        paramTargets={[
          { el: el(), param: { name: 'plain', type: 'text', nullable: true } },
          { el: el(), param: {
            name: 'region', type: 'text', nullable: true,
            source: { query: 'SELECT DISTINCT region FROM sales', connection: 'duckdb' },
          } },
        ]}
        readOnly={false}
        editable
        onEditParamQuery={onEditParamQuery}
      />,
    );
    fireEvent.click(screen.getByLabelText('Edit region options query'));
    expect(onEditParamQuery).toHaveBeenLastCalledWith({
      name: 'region', query: 'SELECT DISTINCT region FROM sales', connection: 'duckdb',
      ref: { format: 'html', occurrence: 1 },
    });
    expect(h.paramProps[0].onRequestEdit).toBeUndefined();
  });
});
