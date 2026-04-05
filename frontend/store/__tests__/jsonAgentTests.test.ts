/**
 * JSON-Driven Agent Tests
 *
 * Runs agent test specs expressed as plain JSON files.
 * Each spec sends a real user prompt to a live agent (real LLM, no mocking)
 * and asserts on the final conversation state using JSONPath expressions.
 *
 * To add tests: edit store/__tests__/agent-tests/*.json
 * To run:       npm test -- store/__tests__/jsonAgentTests.test.ts
 *
 * Requires:
 *   - Python backend running (started automatically)
 *   - data/mxfood.duckdb (downloaded automatically if missing)
 *   - ANTHROPIC_API_KEY or similar in backend/.env
 */

// Must be first — Jest hoists this above all imports
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_json_agent_tests.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
  };
});

import * as path from 'path';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { getTestDbPath, cleanupTestDatabase } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb, addMxfoodConnection, ensureMxfoodDataset } from '@/test/harness/test-db';
import { loadAgentTestSpecs, runAgentTestSpecs } from '@/test/harness/agent-test-runner';

const TEST_DB_PATH = getTestDbPath('json_agent_tests');

(process.env.ANTHROPIC_API_KEY ? describe : describe.skip)('JSON Agent Tests', () => {
  // Download mxfood dataset once before any tests run (no-op if already exists)
  beforeAll(async () => {
    await ensureMxfoodDataset();
  }, 60_000);

  // Real Python backend — no LLM mock, calls real LLM
  const { getPythonPort } = withPythonBackend();

  // Test DB with mxfood connection added via customInit
  const { getStore } = setupTestDb(TEST_DB_PATH, {
    customInit: async (dbPath) => {
      await addMxfoodConnection(dbPath);
    },
  });

  const mockFetch = setupMockFetch({
    getPythonPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler,
      },
    ],
  });

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  // ---------------------------------------------------------------------------
  // Load and register JSON test specs
  // ---------------------------------------------------------------------------

  const specs = loadAgentTestSpecs(path.join(__dirname, 'agent-tests/test-definitions.json'));
  runAgentTestSpecs(specs, { getStore });
});
