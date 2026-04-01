/**
 * Explore page UI test — database selector defaults to first connection.
 *
 * Verifies that when the explore page loads with multiple connections in Redux,
 * the database selector auto-selects the first connection instead of showing
 * the "No connection" placeholder.
 *
 * This test does NOT require a Python backend — no chat interaction, just rendering.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must appear before any import statements
// ---------------------------------------------------------------------------

jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: jest.fn().mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    companyId: 1,
    companyName: 'test-company',
    home_folder: '/org',
    mode: 'org',
  }),
  isAdmin: jest.fn().mockReturnValue(true),
}));

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_explore_connection_default_ui.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
    DB_TYPE: 'sqlite',
  };
});

const mockRouterPush = jest.fn();
jest.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: jest.fn().mockResolvedValue(''),
  SUPPORTED_DOC_EXTENSIONS: [],
}));

jest.mock('@/components/Markdown', () => {
  const React = require('react');
  const MarkdownMock = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', { 'data-testid': 'markdown' }, children);
  return {
    __esModule: true,
    default: MarkdownMock,
  };
});

jest.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({
    navigate: jest.fn(),
    isBlocked: false,
    confirmNavigation: jest.fn(),
    cancelNavigation: jest.fn(),
  }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import React from 'react';
import { screen, waitFor } from '@testing-library/react';

import * as storeModule from '@/store/store';
import { setFiles } from '@/store/filesSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ChatInterface from '@/components/explore/ChatInterface';
import type { DbFile } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    company_id: 1,
    created_at: NOW,
    updated_at: NOW,
    references: [],
    version: 1,
    last_edit_id: null,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Explore page: database selector defaults to first connection', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    mockRouterPush.mockClear();
    window.HTMLElement.prototype.scrollTo = jest.fn();

    // Mock all /api/* calls to return empty success so loading states resolve quickly.
    // Pre-seeded connection files in Redux remain — API returning [] doesn't overwrite them.
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
    // Pre-seed Redux with 2 connections (with non-empty schemas so they pass allowedDatabaseNames filter)
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

    // Database selector should show first connection name — NOT "No connection".
    // No explicit timeout: RTL default (1000ms) is enough — this resolves in < 200ms.
    await waitFor(() => {
      expect(screen.getByLabelText('Database selector')).toHaveTextContent('sales_db');
    });
  });

  it('auto-selects first schema-loaded connection when first connection has no schema', async () => {
    // Bug scenario: first connection has no schema (not yet introspected), others do.
    // auto-select must pick the first connection WITH a schema, not just the first connection —
    // otherwise the selector shows "No connection" because allowedDatabaseNames filters schema-less ones.
    testStore.dispatch(
      setFiles({
        files: [
          makeConnectionFile(1, 'no_schema_db', false),    // no schema — should NOT be auto-selected
          makeConnectionFile(2, 'has_schema_db_1', true),  // has schema — should be auto-selected
          makeConnectionFile(3, 'has_schema_db_2', true),  // has schema — also available
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

    // Should select 'has_schema_db_1' (first WITH schema), NOT show "No connection"
    await waitFor(() => {
      const selector = screen.getByLabelText('Database selector');
      expect(selector).toHaveTextContent('has_schema_db_1');
      expect(selector).not.toHaveTextContent('No connection');
    });
  });

  it('auto-selects first connection when connections arrive after render (SSR timeout scenario)', async () => {
    // Render with empty Redux — simulates SSR timeout where connections weren't pre-loaded
    renderWithProviders(
      <ChatInterface
        conversationId={undefined}
        contextPath="/org"
        container="page"
      />,
      { store: testStore }
    );

    // Simulate connections arriving async (e.g. client-side fetch completes)
    testStore.dispatch(
      setFiles({
        files: [
          makeConnectionFile(1, 'sales_db'),
          makeConnectionFile(2, 'marketing_db'),
        ],
      })
    );

    // After connections arrive, selector should auto-select the first connection
    await waitFor(() => {
      expect(screen.getByLabelText('Database selector')).toHaveTextContent('sales_db');
    });
  });
});
