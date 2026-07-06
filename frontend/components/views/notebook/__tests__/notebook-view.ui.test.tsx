/**
 * NotebookView — a vertical, ordered list of cells. Each cell is either a full
 * inline SQL question (query + viz + connection + params + @refs) or a rich-text
 * cell. The view is presentational: it takes `content` + an `onChange` patch
 * callback and owns cell add/remove/reorder/update as pure array transforms.
 *
 * Heavy leaves are mocked: the rich-text editor, the visualization, the DB/viz
 * selectors, and useQueryResult (so a "run" yields a deterministic result row).
 * The SQL editor is the global Monaco mock (textarea labelled "SQL editor").
 * All element queries by aria-label per repo convention.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { NotebookContent, NotebookSqlCell, NotebookTextCell } from '@/lib/types';

// useQueryResult: return a fixed result whenever a (non-empty) query is run.
vi.mock('@/lib/hooks/file-state-hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/file-state-hooks')>();
  return {
    ...actual,
    useQueryResult: (query: string) =>
      query
        ? { data: { columns: ['n'], types: ['int'], rows: [{ n: 42 }] }, loading: false, error: null, isStale: false, refetch: vi.fn() }
        : { data: null, loading: false, error: null, isStale: false, refetch: vi.fn() },
  };
});

// Avoid network from the @-reference autocomplete hook (fetches all questions).
vi.mock('@/lib/hooks/useAvailableQuestions', () => ({
  useAvailableQuestions: () => ({ questions: [], loading: false }),
}));

// The GUI-compatibility check hits the completions API; stub it.
vi.mock('@/lib/data/completions/completions', () => ({
  CompletionsAPI: { sqlToIR: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/components/question/QuestionVisualization', () => ({
  QuestionVisualization: ({ data }: any) =>
    React.createElement('div', { 'aria-label': 'Cell results' }, JSON.stringify(data?.rows ?? null)),
}));

vi.mock('@/components/selectors/DatabaseSelector', () => ({
  __esModule: true,
  default: ({ value }: any) =>
    React.createElement('div', { 'aria-label': 'Cell connection' }, value ?? ''),
}));

// Available connections, controllable per-test. Default: none (so the first
// SQL cell has no connection to inherit and falls back to '').
const conns = vi.hoisted(() => ({ map: {} as Record<string, unknown> }));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ connections: conns.map, loading: false, error: null }),
}));

vi.mock('@/components/question/VizTypeSelector', () => ({
  VizTypeSelector: () => React.createElement('div', { 'aria-label': 'Viz type selector' }),
}));

vi.mock('@/components/lexical/LexicalTextEditor', () => ({
  __esModule: true,
  default: ({ initialMarkdown, onChange }: any) =>
    React.createElement('textarea', {
      'aria-label': 'Text cell editor',
      defaultValue: initialMarkdown,
      onChange: (e: any) => onChange?.(e.target.value),
    }),
  LexicalTextViewer: ({ markdown }: any) => React.createElement('div', null, markdown),
}));

import NotebookView from '@/components/views/NotebookView';

function sqlCell(over: Partial<NotebookSqlCell> = {}): NotebookSqlCell {
  return {
    type: 'sql', id: 'c1', name: null, query: 'SELECT 42', vizSettings: { type: 'table' },
    parameters: [], parameterValues: {}, connection_name: '', references: [], ...over,
  };
}
function textCell(over: Partial<NotebookTextCell> = {}): NotebookTextCell {
  return { type: 'text', id: 't1', name: null, content: 'hi', ...over };
}

const onChange = vi.fn();
beforeEach(() => { onChange.mockClear(); conns.map = {}; });

describe('NotebookView', () => {
  it('shows the empty state and add-cell controls when there are no cells', () => {
    renderWithProviders(<NotebookView content={{ description: null, cells: [] }} onChange={onChange} />);
    expect(screen.getByLabelText('Empty notebook')).toBeInTheDocument();
    expect(screen.getByLabelText('Add SQL cell')).toBeInTheDocument();
    expect(screen.getByLabelText('Add text cell')).toBeInTheDocument();
  });

  it('adds a SQL cell with a stable id when "Add SQL cell" is clicked', () => {
    renderWithProviders(<NotebookView content={{ description: null, cells: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Add SQL cell'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const cells = onChange.mock.calls[0][0].cells as NotebookContent['cells'];
    expect(cells).toHaveLength(1);
    expect(cells[0].type).toBe('sql');
    expect(cells[0].id).toBeTruthy();
    expect((cells[0] as NotebookSqlCell).connection_name).toBe('');
  });

  it('defaults the first SQL cell to the only available connection', () => {
    conns.map = { only_db: { metadata: { name: 'only_db', type: 'duckdb' } } };
    renderWithProviders(<NotebookView content={{ description: null, cells: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Add SQL cell'));
    const cells = onChange.mock.calls[0][0].cells as NotebookContent['cells'];
    expect((cells[0] as NotebookSqlCell).connection_name).toBe('only_db');
  });

  it('inherits the previous SQL cell connection over the available-connections default', () => {
    conns.map = { other_db: { metadata: { name: 'other_db', type: 'duckdb' } } };
    renderWithProviders(
      <NotebookView content={{ description: null, cells: [sqlCell({ connection_name: 'db_a' })] }} onChange={onChange} />
    );
    const zones = screen.getAllByLabelText('Insert cell');
    fireEvent.mouseEnter(zones[zones.length - 1]);
    fireEvent.click(screen.getByLabelText('Insert SQL cell'));
    const cells = onChange.mock.calls[0][0].cells as NotebookContent['cells'];
    expect((cells.find(c => c.id !== 'c1') as NotebookSqlCell).connection_name).toBe('db_a');
  });

  it('edits a SQL cell query', async () => {
    renderWithProviders(<NotebookView content={{ description: null, cells: [sqlCell({ query: '' })] }} onChange={onChange} />);
    fireEvent.change(await screen.findByLabelText('SQL editor'), { target: { value: 'SELECT 99' } });
    await waitFor(() => {
      const queryUpdate = onChange.mock.calls.find(c => c[0]?.cells?.[0]?.query === 'SELECT 99');
      expect(queryUpdate).toBeTruthy();
    });
  });

  it('runs a SQL cell and shows the result', async () => {
    renderWithProviders(<NotebookView content={{ description: null, cells: [sqlCell()] }} onChange={onChange} />);
    expect(screen.queryByLabelText('Cell results')).not.toBeInTheDocument();
    // Run via the SQL editor's own run button (the header has no redundant one).
    fireEvent.click(await screen.findByLabelText('Run query'));
    await waitFor(() => {
      expect(screen.getByLabelText('Cell results')).toHaveTextContent('42');
    });
  });

  it('adds a text cell and edits its markdown', () => {
    renderWithProviders(<NotebookView content={{ description: null, cells: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Add text cell'));
    const cells = onChange.mock.calls[0][0].cells as NotebookContent['cells'];
    expect(cells[0].type).toBe('text');

    onChange.mockClear();
    renderWithProviders(<NotebookView content={{ description: null, cells: [textCell({ content: '' })] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Text cell editor'), { target: { value: '# Hello' } });
    const edit = onChange.mock.calls.find(c => (c[0]?.cells?.[0] as NotebookTextCell)?.content === '# Hello');
    expect(edit).toBeTruthy();
  });

  it('reflects an external (agent) edit to a text cell', async () => {
    const { rerender } = renderWithProviders(
      <NotebookView content={{ description: null, cells: [textCell({ content: 'old text' })] }} onChange={onChange} />
    );
    const editor = await screen.findByLabelText('Text cell editor') as HTMLTextAreaElement;
    expect(editor.value).toBe('old text');

    // The agent edits the cell content (Redux → new content prop). Lexical seeds
    // its editorState only on mount, so the view must re-seed (remount) to show it.
    rerender(
      <NotebookView content={{ description: null, cells: [textCell({ content: 'new text from agent' })] }} onChange={onChange} />
    );
    await waitFor(() => {
      expect((screen.getByLabelText('Text cell editor') as HTMLTextAreaElement).value).toBe('new text from agent');
    });
  });

  it('defaults a new (hover-inserted) SQL cell to the previous SQL cell connection', () => {
    renderWithProviders(
      <NotebookView content={{ description: null, cells: [sqlCell({ connection_name: 'db_a' })] }} onChange={onChange} />
    );
    // One existing cell → insert zones above and below it; insert below.
    const zones = screen.getAllByLabelText('Insert cell');
    fireEvent.mouseEnter(zones[zones.length - 1]);
    fireEvent.click(screen.getByLabelText('Insert SQL cell'));
    const cells = onChange.mock.calls[0][0].cells as NotebookContent['cells'];
    expect(cells).toHaveLength(2);
    expect((cells.find(c => c.id !== 'c1') as NotebookSqlCell).connection_name).toBe('db_a');
  });

  it('inserts a cell at the hover-zone position', () => {
    renderWithProviders(
      <NotebookView content={{ description: null, cells: [sqlCell({ id: 'a' }), sqlCell({ id: 'b' })] }} onChange={onChange} />
    );
    // Zones in DOM order: [aboveA, betweenAB, belowB]; insert via the middle one.
    const zones = screen.getAllByLabelText('Insert cell');
    fireEvent.mouseEnter(zones[1]);
    fireEvent.click(screen.getByLabelText('Insert text cell'));
    const cells = onChange.mock.calls[0][0].cells as NotebookContent['cells'];
    expect(cells.map(c => c.type)).toEqual(['sql', 'text', 'sql']);
    expect(cells.map(c => c.id).slice(0, 1)).toEqual(['a']);
    expect(cells[2].id).toBe('b');
  });

  it('collapses a cell, hiding its body', async () => {
    renderWithProviders(<NotebookView content={{ description: null, cells: [sqlCell()] }} onChange={onChange} />);
    expect(await screen.findByLabelText('SQL editor')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Collapse cell'));
    expect(screen.queryByLabelText('SQL editor')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Expand cell')).toBeInTheDocument();
  });

  it('marks a cell active when the user interacts with it', () => {
    const onActivateCell = vi.fn();
    renderWithProviders(
      <NotebookView content={{ description: null, cells: [sqlCell({ id: 'a' })] }} onChange={onChange} onActivateCell={onActivateCell} />
    );
    fireEvent.mouseDown(screen.getByLabelText('Cell name'));
    expect(onActivateCell).toHaveBeenCalledWith('a');
  });

  // The JSON/XML "Code view" moved out of NotebookView into the shared CodeView
  // (rendered centrally by FileView) — see components/views/__tests__/code-view.ui.test.tsx.
});
