/**
 * Global Vitest setup — runs before all test files in node + ui projects.
 * Mirrors what jest.setup.js + test/setup/jest.setup.ts did under Jest.
 */
import { vi } from 'vitest';
import { registerModules } from '@/lib/modules/registry';
import { DBModule } from '@/lib/modules/db';

// Clear backend URL env vars; tests must explicitly set their own
delete process.env.NEXT_PUBLIC_BACKEND_URL;
delete process.env.BACKEND_URL;

// Mock server-only module (Next.js 13+ server components)
vi.mock('server-only', () => ({}));

// Stub analytics module — fire-and-forget; stubs match real error-path behaviour.
vi.mock('@/lib/analytics/file-analytics.server', () => ({
  FileEventType: { CREATED: 0, READ_DIRECT: 1, READ_AS_REFERENCE: 2, UPDATED: 3, DELETED: 4 },
  trackFileEvent: vi.fn(),
  trackLLMCallEvents: vi.fn(),
  trackQueryExecutionEvent: vi.fn(),
  insertFileEvent: vi.fn(),
  insertLlmCallEvent: vi.fn(),
  insertQueryExecutionEvent: vi.fn(),
  getFileAnalyticsSummary: vi.fn().mockResolvedValue(null),
  getFilesAnalyticsSummary: vi.fn().mockResolvedValue({}),
  getConversationAnalytics: vi.fn().mockResolvedValue(null),
}));

// Mock NextAuth
vi.mock('next-auth', () => ({ default: vi.fn() }));
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn() }));

// Mock auth module
vi.mock('@/auth', () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// Register default test modules.
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
    db: new DBModule(),
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

// Mock auth helpers with default test user
vi.mock('@/lib/auth/auth-helpers', async () => {
  const { UserDB } = await vi.importActual<typeof import('@/lib/database/user-db')>('@/lib/database/user-db');
  return {
    getEffectiveUser: vi.fn().mockResolvedValue({
      userId: 1,
      email: 'test@example.com',
      name: 'Test User',
      role: 'admin',
      home_folder: '/org',
      mode: 'org',
    }),
    isAdmin: vi.fn().mockReturnValue(true),
    shouldRefreshToken: vi.fn().mockReturnValue(false),
    isTokenOutdated: vi.fn().mockReturnValue(false),
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

// JSDOM globals — Web Fetch API + Node Blob/File (PGLite needs Blob.arrayBuffer)
if (typeof globalThis.window !== 'undefined') {
  if (typeof globalThis.Request === 'undefined') {
    
    globalThis.Request = Request;
    
    globalThis.Response = Response;
    
    globalThis.Headers = Headers;
  }
  if (typeof globalThis.fetch === 'undefined') {
    
    globalThis.fetch = fetch;
  }
  // JSDOM's Blob/File lack arrayBuffer() — override with Node's globals.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeBuffer = require('node:buffer');
  if (nodeBuffer.Blob && typeof nodeBuffer.Blob.prototype.arrayBuffer === 'function') {
    globalThis.Blob = nodeBuffer.Blob;
  }
  if (nodeBuffer.File && typeof nodeBuffer.File.prototype.arrayBuffer === 'function') {
    globalThis.File = nodeBuffer.File;
  }
}
