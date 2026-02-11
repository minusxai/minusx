/**
 * Reusable Python backend lifecycle management for tests
 *
 * Handles starting/stopping the Python backend server on dynamic ports.
 * Use this instead of duplicating beforeAll/afterAll in every test.
 */

import { ChildProcess, spawn } from 'child_process';
import { join } from 'path';
import {
  allocateTestPorts,
  releaseTestPorts
} from '@/store/__tests__/port-manager';
import {
  startPythonBackend,
  waitForPythonBackend,
  killPythonBackend
} from '@/store/__tests__/test-utils';
import { LLMMockServer } from '@/store/__tests__/llm-mock-server';

export interface PythonBackendHarness {
  getPythonPort: () => number;
  getPythonServer: () => ChildProcess;
  shutdown: () => Promise<void>;
  getLLMMockPort?: () => number;
  getLLMMockServer?: () => LLMMockServer;
}

export interface PythonBackendOptions {
  /** Start LLM mock server alongside Python backend */
  withLLMMock?: boolean;
}

/**
 * Sets up a Python backend server for E2E tests.
 *
 * IMPORTANT: This function registers beforeAll/afterAll hooks internally.
 * Call it at the top level of your describe block to ensure proper lifecycle management.
 *
 * Usage:
 * ```ts
 * describe('My Tests', () => {
 *   const { getPythonPort, shutdown } = withPythonBackend();
 *
 *   it('should work', () => {
 *     const port = getPythonPort();
 *     // use port in test
 *   });
 * });
 * ```
 */
export function withPythonBackend(options: PythonBackendOptions = {}): PythonBackendHarness {
  const { withLLMMock = false } = options;

  let allocatedPorts: number[];
  let pythonPort: number;
  let llmMockPort: number | undefined;
  let pythonServer: ChildProcess;
  let mockServer: LLMMockServer | undefined;

  beforeAll(async () => {
    // Allocate ports dynamically (1 or 2 depending on whether we need LLM mock)
    allocatedPorts = await allocateTestPorts(withLLMMock ? 2 : 1);
    pythonPort = allocatedPorts[0];
    if (withLLMMock) {
      llmMockPort = allocatedPorts[1];
    }

    // Update env var
    process.env.NEXT_PUBLIC_BACKEND_URL = `http://localhost:${pythonPort}`;

    // Start LLM mock server if requested
    if (withLLMMock && llmMockPort) {
      mockServer = new LLMMockServer(llmMockPort);
      await mockServer.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Start Python backend with LLM mock URL - use array syntax for stdio
      pythonServer = spawn('uv', [
        'run', 'uvicorn', 'main:app',
        '--port', pythonPort.toString()
      ], {
        cwd: join(process.cwd(), '..', 'backend'),
        env: {
          ...process.env,
          LLM_MOCK_URL: `http://localhost:${llmMockPort}`
        },
        stdio: ['ignore', 'ignore', 'ignore']  // CRITICAL: Detached stdio to prevent memory leaks
      });
    } else {
      // Start Python backend without LLM mock
      pythonServer = startPythonBackend(pythonPort);
    }

    // Wait for backend to be ready (uses default 15s timeout)
    const isReady = await waitForPythonBackend(pythonPort);
    if (!isReady) {
      throw new Error('Failed to start Python backend for tests');
    }
  }, 45000);

  // Shutdown function that can be called explicitly
  const shutdown = async () => {
    try {
      if (mockServer) {
        await mockServer.stop();
      }
      if (pythonServer) {
        await killPythonBackend(pythonServer, pythonPort);
      }
    } catch (error) {
      console.error('Failed to cleanup Python backend:', error);
      throw error;
    } finally {
      releaseTestPorts(allocatedPorts);
    }
  };

  afterAll(async () => {
    await shutdown();
  }, 10000);

  const harness: PythonBackendHarness = {
    getPythonPort: () => pythonPort,
    getPythonServer: () => pythonServer,
    shutdown
  };

  if (withLLMMock) {
    harness.getLLMMockPort = () => llmMockPort!;
    harness.getLLMMockServer = () => mockServer!;
  }

  return harness;
}
