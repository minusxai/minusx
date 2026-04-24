/**
 * E2E Tests: MCP Session Logger
 *
 * Tests the complete flow from "tool was called" to "conversation file exists in DB".
 *
 * What this covers:
 *   logToolCall() (receives tool data)
 *     → flush() (persists via FilesAPI → real DB)
 *     → conversation file readable at expected path with correct structure
 *
 * What this does NOT cover (MCP SDK responsibility, not ours):
 *   - MCP protocol framing / transport-level session management
 *   - OAuth token validation (tested in lib/oauth/__tests__)
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must come before any imports
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

jest.mock('next/cache', () => ({
  revalidateTag: jest.fn(),
  unstable_cache: jest.fn((fn: unknown) => fn),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { resetDB } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { McpSessionLogger } from '@/lib/mcp/session-logger';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationFileContent, TaskLogEntry, TaskResultEntry } from '@/lib/types';
import type { McpToolCallResult } from '@/lib/mcp/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_PATH = getTestDbPath('mcp_logger');

const TEST_USER: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

const TOOL_RESULT: McpToolCallResult = {
  content: [{ type: 'text', text: '{"success":true}' }],
};

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await initTestDatabase(DB_PATH);
  // test@example.com admin user is created by initTestDatabase via workspace-template.json
});

afterAll(async () => {
  await cleanupTestDatabase(DB_PATH);
});

afterEach(async () => {
  // Wipe all files except the /org root between tests, then reset the adapter.
  await getModules().db.exec("DELETE FROM files WHERE path != '/org'", []);
  await resetDB();
});

// ---------------------------------------------------------------------------
// Helper: load conversation file rows directly from the DB
// ---------------------------------------------------------------------------

async function loadConversationRows(): Promise<Array<{ path: string; content: string }>> {
  const { rows } = await getModules().db.exec<{ path: string; content: string }>(
    "SELECT path, content FROM files WHERE type = 'conversation'",
    [],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpSessionLogger — end-to-end session logging', () => {
  const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  describe('flush() after tool calls', () => {
    it('creates a conversation file at the correct path', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('SearchDBSchema', { connection_id: 'main', query: 'revenue' }, TOOL_RESULT);

      await logger.flush();

      const rows = await loadConversationRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].path).toBe(`/org/logs/conversations/1/mcp-${SESSION_ID}`);
    });

    it('stores correct source metadata — type mcp with the session ID', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('SearchDBSchema', { connection_id: 'main' }, TOOL_RESULT);

      await logger.flush();

      const rows = await loadConversationRows();
      const content: ConversationFileContent = JSON.parse(rows[0].content);
      expect(content.metadata.source).toEqual({ type: 'mcp', sessionId: SESSION_ID });
      expect(content.metadata.userId).toBe('1');
    });

    it('records the tool name and arguments in the TaskLogEntry', async () => {
      const args = { connection_id: 'analytics', query: 'SELECT revenue FROM sales' };
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('ExecuteQuery', args, TOOL_RESULT);

      await logger.flush();

      const rows = await loadConversationRows();
      const content: ConversationFileContent = JSON.parse(rows[0].content);
      const taskEntry = content.log.find((e) => e._type === 'task') as TaskLogEntry;
      expect(taskEntry.agent).toBe('ExecuteQuery');
      expect(taskEntry.args).toEqual(args);
    });

    it('records the tool result in the TaskResultEntry', async () => {
      const result: McpToolCallResult = {
        content: [{ type: 'text', text: '{"rows":[{"count":42}]}' }],
      };
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('ExecuteQuery', { connection_id: 'main', query: 'SELECT COUNT(*) FROM orders' }, result);

      await logger.flush();

      const rows = await loadConversationRows();
      const content: ConversationFileContent = JSON.parse(rows[0].content);
      const resultEntry = content.log.find((e) => e._type === 'task_result') as TaskResultEntry;
      expect(resultEntry.result).toEqual(result);
    });

    it('links each TaskResultEntry to its TaskLogEntry via unique_id', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('SearchDBSchema', { connection_id: 'main' }, TOOL_RESULT);

      await logger.flush();

      const rows = await loadConversationRows();
      const content: ConversationFileContent = JSON.parse(rows[0].content);
      const taskEntry = content.log.find((e) => e._type === 'task') as TaskLogEntry;
      const resultEntry = content.log.find((e) => e._type === 'task_result') as TaskResultEntry;

      expect(taskEntry.unique_id).toBeTruthy();
      expect(resultEntry._task_unique_id).toBe(taskEntry.unique_id);
    });
  });

  describe('flush() with no tool calls', () => {
    it('does not create a conversation file', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);

      await logger.flush();

      const rows = await loadConversationRows();
      expect(rows).toHaveLength(0);
    });
  });

  describe('multiple tool calls in a single session', () => {
    it('logs all tool calls in order with correct ID linkage', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);

      logger.logToolCall('SearchDBSchema', { connection_id: 'main', query: 'customers' }, TOOL_RESULT);
      logger.logToolCall('ExecuteQuery', { connection_id: 'main', query: 'SELECT * FROM customers LIMIT 10' }, TOOL_RESULT);

      await logger.flush();

      const rows = await loadConversationRows();
      expect(rows).toHaveLength(1); // still one file per session
      const content: ConversationFileContent = JSON.parse(rows[0].content);

      // 2 tool calls → 2 task entries + 2 result entries = 4 log entries
      expect(content.log).toHaveLength(4);
      expect(content.metadata.logLength).toBe(4);

      // Entries are interleaved: [task1, result1, task2, result2]
      const taskEntries = content.log.filter((e) => e._type === 'task') as TaskLogEntry[];
      const resultEntries = content.log.filter((e) => e._type === 'task_result') as TaskResultEntry[];

      expect(taskEntries[0].agent).toBe('SearchDBSchema');
      expect(taskEntries[1].agent).toBe('ExecuteQuery');

      // Each result references its own task, not the other one
      expect(resultEntries[0]._task_unique_id).toBe(taskEntries[0].unique_id);
      expect(resultEntries[1]._task_unique_id).toBe(taskEntries[1].unique_id);
    });

    it('each tool call gets a distinct unique_id', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);

      logger.logToolCall('SearchDBSchema', { connection_id: 'main' }, TOOL_RESULT);
      logger.logToolCall('ExecuteQuery', { connection_id: 'main', query: 'SELECT 1' }, TOOL_RESULT);

      await logger.flush();

      const rows = await loadConversationRows();
      const content: ConversationFileContent = JSON.parse(rows[0].content);
      const taskEntries = content.log.filter((e) => e._type === 'task') as TaskLogEntry[];

      expect(taskEntries[0].unique_id).not.toBe(taskEntries[1].unique_id);
    });
  });

  describe('error resilience', () => {
    it('flush() silently no-ops if the file cannot be created (path conflict)', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('SearchDBSchema', { connection_id: 'main' }, TOOL_RESULT);

      // First flush succeeds
      await logger.flush();

      // Second flush: same path — FilesAPI will throw; flush must swallow it
      await expect(logger.flush()).resolves.toBeUndefined();
    });
  });
});
