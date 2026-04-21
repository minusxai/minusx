// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockReplaceFileState = jest.fn().mockResolvedValue({ success: true });
jest.mock('@/lib/api/file-state', () => ({
  ...jest.requireActual('@/lib/api/file-state'),
  replaceFileState: (...args: unknown[]) => mockReplaceFileState(...args),
}));

let mockPathname = '/f/1';
const mockRouterPush = jest.fn();

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/components/Sidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/MobileBottomNav', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/lib/hooks/useRecordingContext', () => ({
  RecordingProvider: ({ children }: { children: any }) => {
    const React = require('react');
    return React.createElement(React.Fragment, null, children);
  },
}));

jest.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: jest.fn().mockResolvedValue(''),
  SUPPORTED_DOC_EXTENSIONS: [],
}));

jest.mock('@/components/Markdown', () => {
  const React = require('react');
  const MarkdownMock = ({ children }: { children?: any }) =>
    React.createElement('span', { 'data-testid': 'markdown' }, children);
  return { __esModule: true, default: MarkdownMock };
});

jest.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({
    navigate: jest.fn(),
    isBlocked: false,
    confirmNavigation: jest.fn(),
    cancelNavigation: jest.fn(),
  }),
  NavigationGuardProvider: ({ children }: { children: any }) => children,
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { Box } from '@chakra-ui/react';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as storeModule from '@/store/store';
import { setFile, setFiles } from '@/store/filesSlice';
import { pushView } from '@/store/uiSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { encodeFileStr } from '@/lib/api/file-encoding';
import type { DbFile, ToolCall, ToolMessage, CompletedToolCall, EditFileDetails } from '@/lib/types';

import EditFileDisplay from '@/components/explore/tools/EditFileDisplay';
import FilesList from '@/components/FilesList';
import ViewStackOverlay from '@/components/ViewStack';
import LayoutWrapper from '@/components/LayoutWrapper';
import ChatInterface from '@/components/explore/ChatInterface';

// ─── EditFileDisplay restore buttons ─────────────────────────────────────────

const FILE_ID = 1;

const originalFile = {
  id: FILE_ID,
  name: 'Revenue Query',
  path: '/org/Revenue Query',
  type: 'question',
  content: {
    description: 'Total revenue',
    query: 'SELECT SUM(amount) FROM orders',
    vizSettings: { type: 'table', xCols: [], yCols: [] },
    parameters: [],
    connection_name: 'test',
  },
  isDirty: false,
};

const editedFile = {
  id: FILE_ID,
  name: 'Revenue Query',
  path: '/org/Revenue Query',
  type: 'question',
  content: {
    description: 'Total revenue by month',
    query: "SELECT month, SUM(amount) FROM orders GROUP BY month",
    vizSettings: { type: 'line', xCols: ['month'], yCols: ['amount'] },
    parameters: [],
    connection_name: 'test',
  },
  isDirty: true,
};

const diff = `-${encodeFileStr(originalFile)}\n+${encodeFileStr(editedFile)}`;

function makeToolCallTuple(opts: { fileId: number; success: boolean; diff?: string }): CompletedToolCall {
  const toolCall: ToolCall = {
    id: 'tc_1',
    type: 'function',
    function: {
      name: 'EditFile',
      arguments: { fileId: opts.fileId, changes: [] },
    },
  };
  const toolMessage: ToolMessage = {
    role: 'tool',
    tool_call_id: 'tc_1',
    content: JSON.stringify({ success: opts.success }),
    details: {
      success: opts.success,
      diff: opts.diff,
    } as EditFileDetails,
  };
  return [toolCall, toolMessage];
}

describe('EditFileDisplay restore buttons', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPathname = '/f/1';
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    mockReplaceFileState.mockClear();

    testStore.dispatch(setFile({
      file: {
        id: FILE_ID,
        name: 'Revenue Query',
        path: '/org/Revenue Query',
        type: 'question',
        content: editedFile.content as DbFile['content'],
        references: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        version: 1,
        last_edit_id: null,
      },
    }));
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
  });

  it('shows restore buttons when diff has parseable before/after lines', () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    expect(screen.getByLabelText('Restore to before this edit')).toBeInTheDocument();
    expect(screen.getByLabelText('Restore to after this edit')).toBeInTheDocument();
  });

  it('does not show restore buttons when diff is empty', () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff: '' });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    expect(screen.queryByLabelText('Restore to before this edit')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Restore to after this edit')).not.toBeInTheDocument();
  });

  it('does not show restore buttons on failed edit', () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: false, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    expect(screen.queryByLabelText('Restore to before this edit')).not.toBeInTheDocument();
  });

  it('calls replaceFileState with original content on "Restore to before"', async () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    await userEvent.click(screen.getByLabelText('Restore to before this edit'));

    expect(mockReplaceFileState).toHaveBeenCalledTimes(1);
    expect(mockReplaceFileState).toHaveBeenCalledWith(FILE_ID, originalFile);
  });

  it('calls replaceFileState with final content on "Restore to after" (after undo)', async () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    await userEvent.click(screen.getByLabelText('Restore to before this edit'));
    expect(mockReplaceFileState).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByLabelText('Restore to after this edit'));
    expect(mockReplaceFileState).toHaveBeenCalledTimes(2);
    expect(mockReplaceFileState).toHaveBeenLastCalledWith(FILE_ID, editedFile);
  });

  it('does not call replaceFileState when clicking "Restore to before" twice', async () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    await userEvent.click(screen.getByLabelText('Restore to before this edit'));
    await userEvent.click(screen.getByLabelText('Restore to before this edit'));

    expect(mockReplaceFileState).toHaveBeenCalledTimes(1);
  });

  it('does not call replaceFileState when clicking "Restore to after" without prior undo', async () => {
    const tuple = makeToolCallTuple({ fileId: FILE_ID, success: true, diff });

    renderWithProviders(
      <EditFileDisplay toolCallTuple={tuple} showThinking={true} />,
      { store: testStore }
    );

    await userEvent.click(screen.getByLabelText('Restore to after this edit'));

    expect(mockReplaceFileState).not.toHaveBeenCalled();
  });
});

// ─── FilesList grouping ───────────────────────────────────────────────────────

function makeQuestion(id: number, name: string) {
  return {
    id,
    name,
    type: 'question' as const,
    path: `/org/${name}`,
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

function makeContext(id: number, name: string) {
  return {
    id,
    name,
    type: 'context' as const,
    path: `/org/${name}`,
    content: {},
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

describe('FilesList grouping', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('hides the section header when all visible files belong to a single group', () => {
    renderWithProviders(
      <FilesList files={[makeQuestion(1010, 'Revenue Report'), makeQuestion(1011, 'Sales Summary')]} showToolbar={false} />,
      { store: testStore }
    );

    expect(screen.queryByLabelText('Questions section')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Revenue Report')).toBeInTheDocument();
    expect(screen.getByLabelText('Sales Summary')).toBeInTheDocument();
  });

  it('keeps the only non-context section expanded when knowledge base is also present', () => {
    renderWithProviders(
      <FilesList files={[makeContext(1030, 'Knowledge Base'), makeQuestion(1010, 'Revenue Report')]} showToolbar={false} />,
      { store: testStore }
    );

    expect(screen.getByLabelText('Questions section')).toBeInTheDocument();
    expect(screen.getByLabelText('Revenue Report')).toBeInTheDocument();
    expect(screen.queryByText(/Show 1 Files/i)).not.toBeInTheDocument();
  });
});

// ─── ViewStack navigation cleanup ────────────────────────────────────────────

describe('ViewStack navigation cleanup', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    mockPathname = '/f/2';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the question edit overlay when a view is pushed', async () => {
    renderWithProviders(
      <LayoutWrapper>
        <Box position="relative" h="100vh">
          <ViewStackOverlay />
        </Box>
      </LayoutWrapper>,
      { store: testStore }
    );

    expect(screen.queryByLabelText('Content stack')).not.toBeInTheDocument();

    act(() => {
      testStore.dispatch(pushView({ type: 'question', fileId: 3 }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Content stack')).toBeInTheDocument();
    });
  });

  it('clears the overlay when navigating to a different page', async () => {
    const { rerender } = renderWithProviders(
      <LayoutWrapper>
        <Box position="relative" h="100vh">
          <ViewStackOverlay />
        </Box>
      </LayoutWrapper>,
      { store: testStore }
    );

    act(() => {
      testStore.dispatch(pushView({ type: 'question', fileId: 3 }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Content stack')).toBeInTheDocument();
    });

    mockPathname = '/p/org';
    rerender(
      <LayoutWrapper>
        <Box position="relative" h="100vh">
          <ViewStackOverlay />
        </Box>
      </LayoutWrapper>
    );

    await waitFor(() => {
      expect(screen.queryByLabelText('Content stack')).not.toBeInTheDocument();
    });
  });
});

// ─── Explore page: database selector defaults ─────────────────────────────────

const NOW = new Date().toISOString();

function makeConnectionFile(id: number, name: string, withSchema = true): DbFile {
  return {
    id,
    name,
    path: `/database/${name}`,
    type: 'connection',
    content: {
      type: 'duckdb',
      config: { file_path: `${name}.duckdb` },
      ...(withSchema ? {
        schema: {
          schemas: [
            {
              schema: 'main',
              tables: [
                {
                  table: 'test_table',
                  columns: [{ name: 'id', type: 'INTEGER' }],
                },
              ],
            },
          ],
          updated_at: NOW,
        },
      } : {}),
    },
    created_at: NOW,
    updated_at: NOW,
    references: [],
    version: 1,
    last_edit_id: null,
  };
}

describe('Explore page: database selector defaults to first connection', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPathname = '/explore';
    mockRouterPush.mockClear();
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    window.HTMLElement.prototype.scrollTo = jest.fn();

    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
          text: async () => '',
        } as Response;
      }
      throw new Error(`Unmocked fetch: ${urlStr}`);
    });
  });

  afterEach(() => {
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('auto-selects first connection when connections are pre-loaded in Redux', async () => {
    testStore.dispatch(
      setFiles({
        files: [
          makeConnectionFile(1, 'sales_db'),
          makeConnectionFile(2, 'marketing_db'),
        ],
      })
    );

    renderWithProviders(
      <ChatInterface
        conversationId={undefined}
        contextPath="/org"
        container="page"
      />,
      { store: testStore }
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Database selector')).toHaveTextContent('sales_db');
    });
  });

  it('auto-selects first schema-loaded connection when first connection has no schema', async () => {
    testStore.dispatch(
      setFiles({
        files: [
          makeConnectionFile(1, 'no_schema_db', false),
          makeConnectionFile(2, 'has_schema_db_1', true),
          makeConnectionFile(3, 'has_schema_db_2', true),
        ],
      })
    );

    renderWithProviders(
      <ChatInterface
        conversationId={undefined}
        contextPath="/org"
        container="page"
      />,
      { store: testStore }
    );

    await waitFor(() => {
      const selector = screen.getByLabelText('Database selector');
      expect(selector).toHaveTextContent('has_schema_db_1');
      expect(selector).not.toHaveTextContent('No connection');
    });
  });

  it('auto-selects first connection when connections arrive after render (SSR timeout scenario)', async () => {
    renderWithProviders(
      <ChatInterface
        conversationId={undefined}
        contextPath="/org"
        container="page"
      />,
      { store: testStore }
    );

    testStore.dispatch(
      setFiles({
        files: [
          makeConnectionFile(1, 'sales_db'),
          makeConnectionFile(2, 'marketing_db'),
        ],
      })
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Database selector')).toHaveTextContent('sales_db');
    });
  });
});
