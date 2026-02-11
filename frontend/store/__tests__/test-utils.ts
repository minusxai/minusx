/**
 * Shared test utilities for E2E integration tests
 *
 * Provides common setup, mocking, and helper functions used across test files.
 * All new Redux integration tests should import from this module.
 */

import { configureStore } from '@reduxjs/toolkit';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { ChildProcess } from 'child_process';
import treeKill from 'tree-kill';
import { createEmptyDatabase } from '@/scripts/create-empty-db';
import chatReducer from '../chatSlice';
import { chatListenerMiddleware } from '../chatListener';
import { waitForPortRelease } from './port-manager';

// ============================================================================
// Constants
// ============================================================================

export const TEST_DB_PATH = join(process.cwd(), 'data', 'test_e2e.db');
export const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8001';

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
 * Initialize a fresh test database with schema and test company.
 * Cleans up any existing database and WAL files first.
 */
export async function initTestDatabase(dbPath: string = TEST_DB_PATH) {
  // Clean up existing files
  [dbPath, `${dbPath}-shm`, `${dbPath}-wal`].forEach(file => {
    if (existsSync(file)) unlinkSync(file);
  });

  // Create fresh database
  await createEmptyDatabase(dbPath);

  // Seed with test company
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
  await db.query('INSERT INTO companies (id, name, display_name, subdomain) VALUES ($1, $2, $3, $4)', [
    1, 'test-company', 'Test Company', 'test-company'
  ]);
  await db.close();
}

/**
 * Clean up test database and associated WAL files.
 * Call this in afterAll hook.
 */
export async function cleanupTestDatabase(dbPath: string = TEST_DB_PATH) {
  // Reset adapter to close any open connections
  const { resetAdapter } = await import('@/lib/database/adapter/factory');
  await resetAdapter();

  // Clean up files
  [dbPath, `${dbPath}-shm`, `${dbPath}-wal`].forEach(file => {
    if (existsSync(file)) unlinkSync(file);
  });
}

// ============================================================================
// Python Backend Helpers
// ============================================================================

/**
 * Check if Python backend is running on specified port.
 * Returns true if healthy, false otherwise.
 */
export async function isPythonBackendRunning(port: number = 8001): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start a real Python backend server on specified port.
 * Returns ChildProcess that can be killed in afterAll.
 *
 * @param port Port to run Python backend on (default: 8004 for tests)
 * @returns ChildProcess
 */
export function startPythonBackend(port: number = 8004) {
  const { spawn } = require('child_process');
  const { join } = require('path');

  const backendDir = join(process.cwd(), '..', 'backend');
  const pythonServer = spawn('uv', ['run', 'uvicorn', 'main:app', '--port', port.toString()], {
    cwd: backendDir,
    stdio: ['ignore', 'ignore', 'ignore']  // CRITICAL: Detached stdio to prevent memory leaks
  });

  pythonServer.on('exit', (code: number | null, signal: string | null) => {
    if (code !== null && code !== 0) {
      console.error(`[Python Backend ${port}] Exited with code ${code}, signal ${signal}`);
    }
  });

  return pythonServer;
}

/**
 * Wait for Python backend to be ready.
 * Polls health endpoint until ready or timeout.
 */
export async function waitForPythonBackend(port: number = 8004, timeout: number = 45000): Promise<boolean> {
  // Give process a moment to start before polling
  await new Promise(resolve => setTimeout(resolve, 1000));

  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await isPythonBackendRunning(port)) {
      console.log(`✅ Python backend ready on port ${port}`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.error(`❌ Python backend failed to start on port ${port} within ${timeout}ms`);
  return false;
}

/**
 * Kill Python backend and verify cleanup.
 * Uses tree-kill to ensure entire process tree is terminated,
 * then verifies port is released.
 *
 * @param pythonProcess The ChildProcess to kill
 * @param port Port number to verify is released
 * @param timeout Maximum time to wait for cleanup (default: 10000ms)
 */
export async function killPythonBackend(
  pythonProcess: ChildProcess,
  port: number,
  timeout: number = 10000
): Promise<void> {
  if (!pythonProcess.pid) {
    console.warn('⚠️ Python backend has no PID, may have already exited');
    return;
  }

  console.log(`🛑 Killing Python backend (PID: ${pythonProcess.pid}) on port ${port}...`);

  // CRITICAL: Close stdio streams to prevent memory leaks
  // Remove all listeners first to avoid errors when streams close
  if (pythonProcess.stdout) {
    pythonProcess.stdout.removeAllListeners();
    pythonProcess.stdout.destroy();
  }
  if (pythonProcess.stderr) {
    pythonProcess.stderr.removeAllListeners();
    pythonProcess.stderr.destroy();
  }
  if (pythonProcess.stdin) {
    pythonProcess.stdin.destroy();
  }

  // Use tree-kill to kill entire process tree
  return new Promise((resolve, reject) => {
    // First try graceful kill (SIGTERM)
    treeKill(pythonProcess.pid!, 'SIGTERM', async (err) => {
      if (err) {
        console.warn(`⚠️ Error during graceful kill: ${err.message}`);
        console.log('   Attempting force kill...');

        // Try force kill (SIGKILL)
        treeKill(pythonProcess.pid!, 'SIGKILL', async (killErr) => {
          if (killErr) {
            console.error(`❌ Force kill failed: ${killErr.message}`);
            reject(killErr);
            return;
          }

          // Verify port released
          const released = await waitForPortRelease(port, timeout);
          if (released) {
            console.log(`✅ Port ${port} released successfully (force kill)`);
            resolve();
          } else {
            console.error(`❌ Port ${port} still in use after ${timeout}ms (force kill)`);
            reject(new Error(`Port ${port} not released after force kill`));
          }
        });
        return;
      }

      // Graceful kill succeeded, verify port released
      const released = await waitForPortRelease(port, timeout);
      if (released) {
        console.log(`✅ Port ${port} released successfully`);
        resolve();
      } else {
        console.error(`❌ Port ${port} still in use after ${timeout}ms`);
        reject(new Error(`Port ${port} not released after graceful kill`));
      }
    });
  });
}

/**
 * Print warning if Python backend is not running.
 * Call this in beforeAll hook.
 *
 * @deprecated Use startPythonBackend() instead for self-contained tests
 */
export async function checkPythonBackend() {
  const isRunning = await isPythonBackendRunning();
  if (!isRunning) {
    console.warn('⚠️  Python backend is not running on http://localhost:8001');
    console.warn('   Start it with: cd backend && uv run uvicorn main:app --reload --reload-include=\'*.yaml\' --port 8001');
  }
  return isRunning;
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
  // Import all necessary reducers for full integration testing
  const uiReducer = require('../uiSlice').default;

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
// Fetch Mocking Helpers
// ============================================================================

/**
 * Additional interceptor function for custom API mocking.
 * @param urlStr - The URL being fetched
 * @param init - Fetch init options
 * @returns Response object or null if this interceptor doesn't handle the URL
 */
export type FetchInterceptor = (urlStr: string, init?: any) => Promise<Response | null>;

/**
 * Options for creating a mock fetch function.
 */
export interface CreateMockFetchOptions {
  /** The Next.js POST handler for /api/chat (optional) */
  chatPostHandler?: any;
  /** Python backend port (default: 8001) */
  pythonPort?: number;
  /** Additional custom interceptors for test-specific APIs */
  additionalInterceptors?: FetchInterceptor[];
}

/**
 * Create an extensible mock fetch function that routes API calls appropriately.
 *
 * Features:
 * - Routes Next.js /api/chat calls to the real handler
 * - Lets Python backend calls through to real backend
 * - Mocks health check endpoints
 * - Supports custom interceptors for test-specific APIs
 *
 * IMPORTANT: Only intercepts Next.js /api/chat calls (localhost:3000/api/chat),
 * NOT Python backend calls (localhost:PORT/api/chat).
 *
 * @param options - Configuration options
 * @returns Mock fetch function
 *
 * @example Basic usage:
 * ```typescript
 * const mockFetch = createMockFetch({
 *   chatPostHandler,
 *   pythonPort
 * });
 * jest.spyOn(global, 'fetch').mockImplementation(mockFetch as any);
 * ```
 *
 * @example With custom interceptors:
 * ```typescript
 * const mockFetch = createMockFetch({
 *   chatPostHandler,
 *   pythonPort,
 *   additionalInterceptors: [
 *     async (url, init) => {
 *       if (url.includes('/api/query')) {
 *         return {
 *           ok: true,
 *           status: 200,
 *           json: async () => ({ columns: ['test'], rows: [{ test: 1 }] })
 *         } as Response;
 *       }
 *       return null;  // Let other interceptors handle it
 *     }
 *   ]
 * });
 * ```
 */
export function createMockFetch(options: CreateMockFetchOptions = {}) {
  const {
    chatPostHandler,
    pythonPort = 8001,
    additionalInterceptors = []
  } = options;

  const originalFetch = global.fetch;

  return jest.fn(async (url: string | Request | URL, init?: any) => {
    const urlStr = url.toString();

    // Try additional interceptors first
    for (const interceptor of additionalInterceptors) {
      const response = await interceptor(urlStr, init);
      if (response !== null) {
        return response;
      }
    }

    // Route ONLY Next.js /api/chat calls to handler (not Python backend)
    if (chatPostHandler && (urlStr.includes('localhost:3000/api/chat') || urlStr.startsWith('/api/chat'))) {
      const { NextRequest } = require('next/server');
      const request = new NextRequest('http://localhost:3000/api/chat', {
        method: init?.method || 'POST',
        body: init?.body,
        headers: init?.headers
      });

      const response = await chatPostHandler(request);
      const data = await response.json();

      return {
        ok: response.status === 200,
        status: response.status,
        json: async () => data
      } as Response;
    }

    // Let Python backend calls through
    if (urlStr.includes(`localhost:${pythonPort}`)) {
      return originalFetch(url, init);
    }

    // Mock health check
    if (urlStr.includes('/health')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' })
      } as Response;
    }

    throw new Error(`Unmocked fetch call to ${urlStr}`);
  });
}

// ============================================================================
// API Route Testing Helpers
// ============================================================================

/**
 * Create a NextRequest for testing API routes.
 * Simplifies the creation of test requests.
 */
export function createNextRequest(body: any) {
  const { NextRequest } = require('next/server');
  return new NextRequest('http://localhost:3000/api/chat', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * Skip test if Python backend is not running.
 * Returns true if test should continue, false if skipped.
 *
 * @deprecated Should not be needed with self-contained tests
 */
export async function skipIfBackendDown(port: number = 8001): Promise<boolean> {
  const isRunning = await isPythonBackendRunning(port);
  if (!isRunning) {
    console.log(`⏭️  Skipping test - Python backend not running on port ${port}`);
  }
  return isRunning;
}
