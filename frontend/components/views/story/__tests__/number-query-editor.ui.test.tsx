/**
 * NumberQueryEditor — the light-DOM modal that hosts the FULL SqlEditor for editing an inline
 * <Number>'s query (with real autocomplete, outside the story shadow root). SqlEditor is Monaco
 * (browser-only), so it's mocked here to a textarea; we assert the modal wires value/onChange to it,
 * passes the connection's schema for autocomplete, and that Apply hands the edited query to the
 * request's `apply`.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

const sqlEditorProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/SqlEditor', () => ({
  __esModule: true,
  default: (props: { value: string; onChange?: (v: string) => void }) => {
    sqlEditorProps.push(props);
    return React.createElement('textarea', {
      'aria-label': 'SQL editor',
      value: props.value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => props.onChange?.(e.target.value),
    });
  },
}));
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ databases: [{ databaseName: 'duck', schemas: [{ schema: 'main', tables: [] }] }] }),
}));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ connections: { duck: { metadata: { type: 'duckdb' } } } }),
}));

import NumberQueryEditor from '../NumberQueryEditor';

describe('NumberQueryEditor (light-DOM SqlEditor modal)', () => {
  beforeEach(() => { sqlEditorProps.length = 0; });

  it('opens the SqlEditor seeded with the query + the connection schema, and Apply emits the edit', async () => {
    const apply = vi.fn();
    const request = { query: 'SELECT 1 AS v', connection: 'duck', apply };
    renderWithProviders(<NumberQueryEditor request={request} filePath="/org/story" onClose={() => {}} />);

    const editor = await screen.findByLabelText('SQL editor');
    expect((editor as HTMLTextAreaElement).value).toBe('SELECT 1 AS v');
    // schema for the connection is threaded in → autocomplete has data
    await waitFor(() => {
      const last = sqlEditorProps[sqlEditorProps.length - 1];
      expect(last.databaseName).toBe('duck');
      expect(last.connectionType).toBe('duckdb');
      expect(Array.isArray(last.schemaData)).toBe(true);
    });

    fireEvent.change(editor, { target: { value: 'SELECT 2 AS v' } });
    fireEvent.click(screen.getByLabelText('apply number query edit'));
    expect(apply).toHaveBeenCalledWith('SELECT 2 AS v');
  });

  it('renders nothing when there is no request', () => {
    renderWithProviders(<NumberQueryEditor request={null} filePath="/org/story" onClose={() => {}} />);
    expect(screen.queryByLabelText('SQL editor')).toBeNull();
  });
});
