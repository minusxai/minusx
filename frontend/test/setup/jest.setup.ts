/**
 * Global Jest setup - runs before all test files
 *
 * This file contains mocks that apply to ALL tests.
 * Runs via setupFilesAfterEnv in jest.config.js
 */

// Mock server-only module (Next.js 13+ server components)
jest.mock('server-only', () => ({}));

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
jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: jest.fn().mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    companyId: 1,
    role: 'admin',
    home_folder: '/test'
  })
}));
