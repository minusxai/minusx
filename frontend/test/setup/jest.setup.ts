/**
 * Global Jest setup - runs before all test files
 *
 * This file contains mocks that apply to ALL tests.
 * Runs via setupFilesAfterEnv in jest.config.js
 */

// Mock server-only module (Next.js 13+ server components)
jest.mock('server-only', () => ({}));

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

// Mock auth helpers with default test user
jest.mock('@/lib/auth/auth-helpers', () => {
  // Use actual DB modules so getCompanyUserEffectiveUser works with real test DBs
  const { UserDB } = jest.requireActual('@/lib/database/user-db');
  const { CompanyDB } = jest.requireActual('@/lib/database/company-db');
  return {
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
    shouldRefreshToken: jest.fn().mockReturnValue(false),
    isTokenOutdated: jest.fn().mockReturnValue(false),
    getCompanyUserEffectiveUser: async (
      companyId: number,
      email: string,
      mode: string,
    ) => {
      const [user, company] = await Promise.all([
        UserDB.getByEmailAndCompany(email, companyId),
        CompanyDB.getById(companyId),
      ]);
      if (!user) return null;
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        home_folder: user.home_folder,
        companyId,
        companyName: company?.name,
        mode,
      };
    },
  };
});
