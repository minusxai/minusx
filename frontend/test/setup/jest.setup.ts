/**
 * Global Jest setup - runs before all test files
 *
 * This file contains mocks that apply to ALL tests.
 * Runs via setupFilesAfterEnv in jest.config.js
 */

// Mock server-only module (Next.js 13+ server components)
jest.mock('server-only', () => ({}));

// Suppress console.log during tests — production code (connectionLoader, ChatInterface, etc.)
// emits noisy logs that obscure real test failures. Use console.warn/error for signal.
const originalLog = console.log.bind(console);
beforeAll(() => { console.log = () => {}; });
afterAll(() => { console.log = originalLog; });

// Prevent native DuckDB binary from loading in any Jest worker.
// Any import chain reaching file-analytics.db.ts triggers require('duckdb') — a native C++
// module whose destructor SIGSEGV-crashes the worker process on exit, causing flaky CI failures.
// Analytics is fire-and-forget; these stubs match real error-path behaviour.
jest.mock('@/lib/analytics/file-analytics.server', () => ({
  trackFileEvent: jest.fn().mockResolvedValue(undefined),
  trackLLMCallEvents: jest.fn().mockResolvedValue(undefined),
  getFileAnalyticsSummary: jest.fn().mockResolvedValue(null),
  getFilesAnalyticsSummary: jest.fn().mockResolvedValue({}),
  getConversationAnalytics: jest.fn().mockResolvedValue(null),
}));

// Mock NextAuth
jest.mock('next-auth', () => ({ default: jest.fn() }));
jest.mock('next-auth/providers/credentials', () => ({ default: jest.fn() }));

// Mock auth module
jest.mock('@/auth', () => ({
  auth: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn()
}));

// Register default test modules — DocumentDB routes through getModules().db.exec().
// This module lazily calls getAdapter() on each exec() so tests that call resetAdapter()
// in beforeEach always pick up the fresh adapter after re-initialization.
// Tests that need a different module (e.g. pglite-adapter.test.ts) call registerModules()
// in their own beforeEach, overwriting this default registration.
{
  const { registerModules } = require('@/lib/modules/registry');
  registerModules({
    auth: {
      handleRequest: async () => { throw new Error('auth.handleRequest not available in tests'); },
      getRequestContext: async () => ({
        userId: 1, email: 'test@example.com', name: 'Test User',
        role: 'admin' as const, home_folder: '/org', mode: 'org' as const,
      }),
      addHeaders: async () => true,
      register: async () => { throw new Error('auth.register not available in tests'); },
    },
    db: {
      exec: async (sql: string, params?: unknown[]) => {
        // Lazy: get adapter at call time — respects resetAdapter() in test beforeEach
        const { getAdapter } = require('@/lib/database/adapter/factory');
        const adapter = await getAdapter();
        // Multi-statement DDL: route through exec() (no prepared statements).
        if ((!params || params.length === 0) && sql.includes(';')) {
          await adapter.exec(sql);
          return { rows: [] };
        }
        return adapter.query(sql, params);
      },
      init: async () => {},
    },
    store: {
      resolvePath: () => '',
      getUploadUrl: async () => { throw new Error('store.getUploadUrl not available in tests'); },
      getDownloadUrl: async () => { throw new Error('store.getDownloadUrl not available in tests'); },
      generateKey: () => { throw new Error('store.generateKey not available in tests'); },
    },
    cache: {
      get: async () => null,
      set: async () => {},
      invalidate: async () => {},
      invalidatePrefix: async () => {},
    },
  });
}

// Mock auth helpers with default test user
jest.mock('@/lib/auth/auth-helpers', () => {
  const { UserDB } = jest.requireActual('@/lib/database/user-db');
  return {
    getEffectiveUser: jest.fn().mockResolvedValue({
      userId: 1,
      email: 'test@example.com',
      name: 'Test User',
      role: 'admin',
      home_folder: '/org',
      mode: 'org',
    }),
    isAdmin: jest.fn().mockReturnValue(true),
    shouldRefreshToken: jest.fn().mockReturnValue(false),
    isTokenOutdated: jest.fn().mockReturnValue(false),
    getUserEffectiveUser: async (email: string, mode: string) => {
      const user = await UserDB.getByEmail(email);
      if (!user) return null;
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        home_folder: user.home_folder,
        mode,
      };
    },
  };
});
