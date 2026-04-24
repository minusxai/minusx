/**
 * Shared test utilities for E2E integration tests
 *
 * Provides common setup, mocking, and helper functions used across test files.
 * All new Redux integration tests should import from this module.
 */

import { configureStore } from '@reduxjs/toolkit';
import { join } from 'path';
import { ChildProcess } from 'child_process';
import treeKill from 'tree-kill';
import { initializeDatabase } from '@/lib/database/import-export';
import chatReducer from '../chatSlice';
import { chatListenerMiddleware } from '../chatListener';
import { waitForPortRelease } from './port-manager';

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

