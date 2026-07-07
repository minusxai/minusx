/**
 * CodeView — the admin "Code view" body: an editable JSON tab plus a read-only
 * XML tab showing the exact agent-facing markup (fileToMarkup). A small JSON|XML
 * sub-toggle switches between them. All element queries by aria-label per repo
 * convention (the Monaco mock labels the editor textarea "<LANG> editor"; the
 * sub-toggle buttons are labelled "JSON" / "XML").
 *
 * As of M4.2, CodeView no longer reads Redux itself — `persistableContent`/
 * `mergedContent` are sourced by the caller (ContextEditorV2 / FileView) and
 * passed as props. Tests still dispatch `setFile` into a real store (so
 * `applyJsonContentEdit`, which writes via `getStore()` directly, has
 * somewhere real to write), but now also compute those two props from the
 * same store state via the real selectors — exercising the exact production
 * derivation instead of hand-rolling it.
 */
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile, selectPersistableContent, selectMergedContent } from '@/store/filesSlice';
import CodeView from '@/components/views/CodeView';
import { shapeContextForAgent } from '@/lib/context/context-agent-view';

const FILE_ID = 4242;

function contentProps(store: ReturnType<typeof storeModule.makeStore>, fileId: number) {
  const state = store.getState();
  return {
    persistableContent: selectPersistableContent(state, fileId),
    mergedContent: selectMergedContent(state, fileId),
  };
}

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

const CTX_ID = 5151;

function makeContextDbFile() {
  return {
    id: CTX_ID,
    name: 'Sales context',
    type: 'context' as const,
    path: '/configs/contexts/sales',
    content: {
      published: { all: 1 },
      versions: [{ version: 1, whitelist: [], docs: [], createdAt: 'x', createdBy: 1 }],
      // Loader-computed / inherited — should be hidden from the Code view.
      fullSchema: [{ databaseName: 'db', schemas: [{ schema: 'public', tables: [] }] }],
      parentSchema: [{ databaseName: 'parent_db', schemas: [] }],
      fullDocs: [{ title: 'inherited', body: 'x' }],
    } as Record<string, unknown>,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

function setupContext() {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file: makeContextDbFile() as never, references: [] }));
  return testStore;
}

describe('CodeView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the JSON tab and shows the file content as JSON', () => {
    const store = setup();
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" {...contentProps(store, FILE_ID)} editable />, { store });

    const json = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(json.value).toContain('SELECT 1');
    expect(json.value).toContain('"vizSettings"');
    // XML surface not mounted until the sub-toggle is used.
    expect(screen.queryByLabelText('XML editor')).not.toBeInTheDocument();
  });

  it('shows the read-only agent XML markup when the XML sub-toggle is clicked', () => {
    const store = setup();
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" {...contentProps(store, FILE_ID)} editable />, { store });

    fireEvent.click(screen.getByLabelText('XML'));

    const xml = screen.getByLabelText('XML editor') as HTMLTextAreaElement;
    expect(xml.value).toContain('<query');
    expect(xml.value).toContain('SELECT 1');
    expect(xml.readOnly).toBe(true);
    expect(screen.queryByLabelText('JSON editor')).not.toBeInTheDocument();
  });

  it('JSON tab is read-only when not editable', () => {
    const store = setup();
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" {...contentProps(store, FILE_ID)} editable={false} />, { store });

    const json = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(json.readOnly).toBe(true);
  });

  it('returns to JSON content after toggling JSON -> XML -> JSON', () => {
    const store = setup();
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" {...contentProps(store, FILE_ID)} editable />, { store });

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
    renderWithProviders(<CodeView fileId={FILE_ID} fileType="question" {...contentProps(store, FILE_ID)} editable />, { store });

    const json = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(json.readOnly).toBe(false);
  });

  it('JSON tab hides omitKeys but keeps the real (version-based) file', () => {
    const store = setupContext();
    const omit = ['fullSchema', 'parentSchema', 'fullDocs'];
    renderWithProviders(
      <CodeView fileId={CTX_ID} fileType="context" {...contentProps(store, CTX_ID)} editable omitKeys={omit} xmlContentTransform={shapeContextForAgent} />, { store },
    );

    // JSON tab: the real saved file, minus the loader-computed keys.
    const json = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(json.value).toContain('"versions"');
    expect(json.value).not.toContain('fullSchema');
    expect(json.value).not.toContain('parentSchema');
    expect(json.value).not.toContain('fullDocs');

    // Agent XML tab (agent view): flat, no version wrapper, no computed cache.
    fireEvent.click(screen.getByLabelText('Agent XML'));
    const xml = screen.getByLabelText('XML editor') as HTMLTextAreaElement;
    expect(xml.value).not.toContain('<versions');
    expect(xml.value).not.toContain('fullSchema');
    expect(xml.value).not.toContain('parentSchema');
  });

  it('shows three stages for context: File JSON, Agent JSON, and Agent XML', () => {
    // Stored file is version-based with a live-version doc; the agent sees the FLATTENED view.
    const store = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    store.dispatch(setFile({
      file: {
        ...makeContextDbFile(),
        content: {
          published: { all: 1 },
          versions: [{ version: 1, whitelist: [{ name: 'db', type: 'connection' }], docs: [{ content: '# Live doc', title: 'D', description: 'd' }], createdAt: 'x', createdBy: 1 }],
          fullSchema: [{ databaseName: 'db', schemas: [] }],
        } as Record<string, unknown>,
      } as never,
      references: [],
    }));

    renderWithProviders(
      <CodeView fileId={CTX_ID} fileType="context" {...contentProps(store, CTX_ID)} omitKeys={['fullSchema', 'parentSchema', 'fullDocs']} xmlContentTransform={shapeContextForAgent} />,
      { store },
    );

    // 1) File JSON — the real saved file (version-based), minus the loader-computed keys.
    const fileJson = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(fileJson.value).toContain('"versions"');
    expect(fileJson.value).not.toContain('fullSchema');

    // 2) Agent JSON — the flattened view (docs at top level, no version wrapper / whitelist).
    fireEvent.click(screen.getByLabelText('Agent JSON'));
    const agentJson = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(agentJson.value).toContain('"docs"');
    expect(agentJson.value).toContain('# Live doc');
    expect(agentJson.value).not.toContain('versions');
    expect(agentJson.value).not.toContain('whitelist');

    // 3) Agent XML — fileToMarkup of that same agent view.
    fireEvent.click(screen.getByLabelText('Agent XML'));
    const xml = screen.getByLabelText('XML editor') as HTMLTextAreaElement;
    expect(xml.value).toContain('<docs>');
    expect(xml.value).toContain('# Live doc');
    expect(xml.value).not.toContain('<versions');
    expect(xml.value).not.toContain('<published');
    expect(xml.value).not.toContain('<whitelist');
  });

  it('preserves omitKeys when the trimmed JSON is edited', () => {
    const store = setupContext();
    const omit = ['fullSchema', 'parentSchema', 'fullDocs'];
    renderWithProviders(
      <CodeView fileId={CTX_ID} fileType="context" {...contentProps(store, CTX_ID)} editable omitKeys={omit} />, { store },
    );

    // Edit the trimmed JSON (no derived fields present) and confirm they survive on the file.
    const json = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    fireEvent.change(json, {
      target: { value: JSON.stringify({ published: { all: 2 }, versions: [] }) },
    });

    const saved = store.getState().files.files[CTX_ID];
    const content = { ...saved.content, ...saved.persistableChanges } as Record<string, unknown>;
    expect((content.published as { all: number }).all).toBe(2);
    expect(content.fullSchema).toBeDefined();
    expect(content.parentSchema).toBeDefined();
    expect(content.fullDocs).toBeDefined();
  });
});
