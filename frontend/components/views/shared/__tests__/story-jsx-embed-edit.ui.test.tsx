/**
 * StoryJsxBody — edit affordances for embeds on format:'jsx' stories (story edit mode).
 * - saved <Question id>: the card's actions menu / Edit fires onEditQuestion with kind:'saved'
 *   + a jsx ref carrying the embed's AST path (+ its story-level viz override);
 * - inline <Question query>: the same "Card actions" menu the legacy path renders fires
 *   kind:'inline' with the parsed embed + jsx ref;
 * - inline <Number query>: the number's edit request carries the AST path (the story view owns
 *   the source write-back on the jsx path).
 * The embed containers are mocked; the affordance wiring is under test.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const h = vi.hoisted(() => ({
  smartProps: [] as Record<string, unknown>[],
  numberProps: [] as Record<string, unknown>[],
}));

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    h.smartProps.push(props);
    return React.createElement('button', {
      'aria-label': `Edit saved ${props.questionId}`,
      onClick: () => (props.onEdit as (() => void) | undefined)?.(),
    });
  };
  return { __esModule: true, default: Fake };
});

vi.mock('@/components/containers/EmbeddedQuestionContainer', async () => {
  const React = await import('react');
  return { __esModule: true, default: () => React.createElement('div', { 'aria-label': 'Inline embed body' }) };
});

vi.mock('@/components/views/story/InlineNumber', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    h.numberProps.push(props);
    return React.createElement('button', {
      'aria-label': 'Edit number query',
      onClick: () => (props.onRequestEdit as (() => void) | undefined)?.(),
    });
  };
  return { __esModule: true, default: Fake };
});

import StoryJsxBody from '../StoryJsxBody';

const OVERRIDE: VizEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: '.mx-th{background:#111}' },
};

// Paths: div=0 → [saved Question=0.0, Card=0.1 (inline Question=0.1.0), Number=0.2]
const JSX_DOC = `<div className="p-8"><Question id={42} viz={${JSON.stringify(OVERRIDE)}} height="500px" /><Card><Question query={\`SELECT 1\`} connection="duckdb" height="340px" /></Card><Number query={\`SELECT count(*) FROM t\`} connection="duckdb" prefix="$" /></div>`;

beforeEach(() => {
  h.smartProps.length = 0;
  h.numberProps.length = 0;
});

function renderBody(overrides: Partial<React.ComponentProps<typeof StoryJsxBody>> = {}) {
  return renderWithProviders(
    <StoryJsxBody
      doc={document}
      jsx={JSX_DOC}
      readOnly={false}
      editable
      {...overrides}
    />,
  );
}

describe('StoryJsxBody — embed edit affordances (jsx stories)', () => {
  it('saved embeds report kind:saved with their AST path ref and viz override', () => {
    const onEditQuestion = vi.fn();
    renderBody({ onEditQuestion });
    fireEvent.click(screen.getByLabelText('Edit saved 42'));
    expect(onEditQuestion).toHaveBeenLastCalledWith({
      kind: 'saved', questionId: 42, vizOverride: OVERRIDE, ref: { format: 'jsx', astPath: '0.0' },
    });
    // edit mode shows the card's actions menu (same flag the legacy path sets)
    expect(h.smartProps[0].showActionsMenu).toBe(true);
  });

  it('inline embeds get the shared "Card actions" menu firing kind:inline with the AST path', async () => {
    const onEditQuestion = vi.fn();
    renderBody({ onEditQuestion });
    fireEvent.click(screen.getByLabelText('Card actions'));
    fireEvent.click(await screen.findByLabelText('Edit question'));
    expect(onEditQuestion).toHaveBeenLastCalledWith({
      kind: 'inline',
      embed: { query: 'SELECT 1', connection: 'duckdb', height: '340px' },
      ref: { format: 'jsx', astPath: '0.1.0' },
    });
  });

  it('inline numbers request edits with their AST path (no apply closure on the jsx path)', () => {
    const onEditNumber = vi.fn();
    renderBody({ onEditNumber });
    expect(h.numberProps[0].editable).toBe(true);
    fireEvent.click(screen.getByLabelText('Edit number query'));
    expect(onEditNumber).toHaveBeenLastCalledWith({
      query: 'SELECT count(*) FROM t', connection: 'duckdb', astPath: '0.2',
    });
  });

  it('shows no edit affordances outside edit mode', () => {
    renderBody({ editable: false, onEditQuestion: vi.fn(), onEditNumber: vi.fn() });
    expect(screen.queryByLabelText('Card actions')).toBeNull();
    expect(h.smartProps[0].showActionsMenu).toBe(false);
    expect(h.smartProps[0].onEdit).toBeUndefined();
    expect(h.numberProps[0].editable).toBe(false);
    expect(h.numberProps[0].onRequestEdit).toBeUndefined();
  });
});
