/**
 * Shared test utilities for E2E integration tests
 *
 * Provides common setup, mocking, and helper functions used across test files.
 * All new Redux integration tests should import from this module.
 */

import { configureStore } from '@reduxjs/toolkit';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { initializeDatabase } from '@/lib/database/import-export';
import chatReducer from '../chatSlice';
import uiReducer from '../uiSlice';
import { chatListenerMiddleware } from '../chatListener';

// ============================================================================
// Jest Mock Setup - Important Limitations
// ============================================================================

/**
 * ⚠️ Jest Hoisting Limitation
 *
 * jest.mock() calls are hoisted to the TOP of the module, BEFORE any imports.
 * This means you CANNOT:
 * - Import factory functions and call them in jest.mock()
 * - Reference variables defined in the test file
 * - Use dynamic values computed at runtime
 *
 * ❌ This does NOT work:
 * ```typescript
 * import { createDbMockFactory } from './test-utils';
 * jest.mock('@/lib/database/db-config', createDbMockFactory('test.db'));
 * // Error: Cannot access 'test_utils' before initialization
 * ```
 *
 * ✅ This DOES work:
 * ```typescript
 * jest.mock('@/lib/database/db-config', () => {
 *   const path = require('path');  // Can use require() inside factory
 *   return {
 *     DB_PATH: path.join(process.cwd(), 'data', 'test.db'),
 *     DB_DIR: path.join(process.cwd(), 'data')
 *   };
 * });
 * ```
 *
 * The ~21 lines of mock setup in each test file CANNOT be reduced via
 * imported factory functions. This duplication is a necessary cost of
 * Jest's hoisting mechanism.
 *
 * For more info:
 * - https://jestjs.io/docs/manual-mocks
 * - https://dev.to/jobber/serious-jest-making-sense-of-hoisting-253i
 */

// ============================================================================
// Test Database Management
// ============================================================================

/**
 * Truncate all public-schema tables between tests.
 * Faster than reset() and safe for PGLite (avoids WASM close/restart).
 */
export async function truncateAllTables(): Promise<void> {
  const { getModules } = await import('@/lib/modules/registry');
  await getModules().db.exec(
    `DO $$ DECLARE r RECORD; BEGIN
       FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
         EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
       END LOOP;
     END $$`
  );
}

/**
 * Initialize a fresh test database with schema and test org.
 * Cleans up any existing database and WAL files first.
 */
export async function initTestDatabase(dbPath: string = join(process.cwd(), 'data', 'test_e2e.db')) {
  // Seed via initializeDatabase — uses workspace-template.json, same as production.
  await initializeDatabase('Test User', 'test@example.com', 'password', dbPath);
}

/**
 * Clean up test database and associated WAL files.
 * Call this in afterAll hook.
 */
export async function cleanupTestDatabase(_dbPath: string = join(process.cwd(), 'data', 'test_e2e.db')) {
  const { getModules } = await import('@/lib/modules/registry');
  await getModules().db.reset?.();
}


// ============================================================================
// Async Helpers
// ============================================================================

/**
 * Wait for a condition to become true.
 * Throws error if timeout is reached.
 *
 * @param condition Function that returns true when condition is met
 * @param timeout Maximum time to wait in milliseconds (default: 5000)
 * @param interval Polling interval in milliseconds (default: 100)
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor timeout');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

// ============================================================================
// Redux Store Setup
// ============================================================================

/**
 * Create a test Redux store with chat reducer and listener middleware.
 * Use this for Redux integration tests.
 */
export function setupTestStore() {
  return configureStore({
    reducer: {
      chat: chatReducer,
      ui: uiReducer
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware()
        .prepend(chatListenerMiddleware.middleware)
  });
}

// ============================================================================
// Test Path Utilities
// ============================================================================

/**
 * Get the path to a test database file.
 * Provides consistent naming convention for test databases.
 *
 * @param testName - Name identifier for the test (e.g., 'e2e', 'nested_tools')
 * @returns Absolute path to test database file
 *
 * @example
 * const dbPath = getTestDbPath('e2e');
 * // Returns: /path/to/project/data/test_e2e.db
 */
export function getTestDbPath(testName: string): string {
  return join(process.cwd(), 'data', `test_${testName}.db`);
}

// ============================================================================
// API Route Testing Helpers
// ============================================================================

/**
 * Create a NextRequest for testing the /api/chat route handler.
 * Simplifies the creation of test requests.
 */
export function createNextRequest(body: any) {
  return new NextRequest('http://localhost:3000/api/chat', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

// ============================================================================
// Draft-aware fixture helpers
// ============================================================================

/**
 * Create a published (non-draft) fixture file for use in tests.
 *
 * Usage:
 *   const id = await mkPublished('My File', '/org/my-file', 'question', content, []);
 */
export async function mkPublished(
  name: string,
  path: string,
  type: string,
  content: object,
  refs: number[] = [],
  editId?: string
): Promise<number> {
  const { DocumentDB } = await import('@/lib/database/documents-db');
  return DocumentDB.create(name, path, type, content as any, refs, editId, false);
}

