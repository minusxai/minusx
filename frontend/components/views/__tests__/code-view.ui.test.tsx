/**
 * CodeView — the admin "Code view" body: an editable JSON tab plus a read-only
 * XML tab showing the exact agent-facing markup (fileToMarkup). A small JSON|XML
 * sub-toggle switches between them. All element queries by aria-label per repo
 * convention (the Monaco mock labels the editor textarea "<LANG> editor"; the
 * sub-toggle buttons are labelled "JSON" / "XML").
 */
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import CodeView from '@/components/views/CodeView';

const FILE_ID = 4242;

function makeQuestionDbFile() {
  return {
    id: FILE_ID,
    name: 'Revenue',
    type: 'question' as const,
    path: '/org/Revenue',
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

function setup() {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
  return testStore;
}

describe('CodeView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the JSON tab and shows the file content as JSON', () => {
    const store = setup();
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" editable />, { store });

    const json = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(json.value).toContain('SELECT 1');
    expect(json.value).toContain('"vizSettings"');
    // XML surface not mounted until the sub-toggle is used.
    expect(screen.queryByLabelText('XML editor')).not.toBeInTheDocument();
  });

  it('shows the read-only agent XML markup when the XML sub-toggle is clicked', () => {
    const store = setup();
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" editable />, { store });

    fireEvent.click(screen.getByLabelText('XML'));

    const xml = screen.getByLabelText('XML editor') as HTMLTextAreaElement;
    expect(xml.value).toContain('<query');
    expect(xml.value).toContain('SELECT 1');
    expect(xml.readOnly).toBe(true);
    expect(screen.queryByLabelText('JSON editor')).not.toBeInTheDocument();
  });

  it('JSON tab is read-only when not editable', () => {
    const store = setup();
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" editable={false} />, { store });

    const json = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(json.readOnly).toBe(true);
  });

  it('returns to JSON content after toggling JSON -> XML -> JSON', () => {
    const store = setup();
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" editable />, { store });

    fireEvent.click(screen.getByLabelText('XML'));
    expect((screen.getByLabelText('XML editor') as HTMLTextAreaElement).value).toContain('<query');

    fireEvent.click(screen.getByLabelText('JSON'));
    const json = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(json.value).toContain('"query"');
    expect(json.value).not.toContain('<query');
    expect(screen.queryByLabelText('XML editor')).not.toBeInTheDocument();
  });

  it('JSON tab is editable when editable', () => {
    const store = setup();
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" editable />, { store });

    const json = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(json.readOnly).toBe(false);
  });
});
