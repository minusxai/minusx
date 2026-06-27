/**
 * E2E Tests: MCP Session Logger (v3)
 *
 * Tests the complete flow from "tool was called" to "v3 conversation exists in the DB".
 *
 *   logToolCall() (receives tool data)
 *     → flush() (converts the buffered task-log to pi via legacyLogToPi,
 *                writes a v3 conversation + messages rows)
 *     → conversation readable with mcp source metadata + the tool calls in its log
 *
 * MCP sessions are regular v3 conversations now — no file-conversation surface.
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}));

import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { getModules } from '@/lib/modules/registry';
import { McpSessionLogger } from '@/lib/mcp/session-logger';
import { loadLog } from '@/lib/data/conversations.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { McpToolCallResult } from '@/lib/mcp/server';

const DB_PATH = getTestDbPath('mcp_logger');

const TEST_USER: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

const TOOL_RESULT: McpToolCallResult = { content: [{ type: 'text', text: '{"success":true}' }] };

beforeAll(async () => { await initTestDatabase(DB_PATH); });
afterAll(async () => { await cleanupTestDatabase(DB_PATH); });
afterEach(async () => {
  await getModules().db.exec("DELETE FROM files WHERE path != '/org'", []);
  await getModules().db.exec('DELETE FROM messages', []);
  await getModules().db.exec('DELETE FROM conversations', []);
});

/** Load the MCP v3 conversations (agent='McpSession') with their meta. */
async function loadMcpConversations(): Promise<Array<{ id: number; meta: Record<string, unknown> }>> {
  const { rows } = await getModules().db.exec<{ id: number; meta: unknown }>(
    "SELECT id, meta FROM conversations WHERE agent = 'McpSession' ORDER BY id", [],
  );
  return rows.map((r) => ({ id: Number(r.id), meta: (typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta) as Record<string, unknown> }));
}

describe('McpSessionLogger — end-to-end session logging (v3)', () => {
  const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  describe('flush() after tool calls', () => {
    it('creates exactly one v3 conversation for the session', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('SearchDBSchema', { connection_id: 'main', query: 'revenue' }, TOOL_RESULT);
      await logger.flush();

      const convs = await loadMcpConversations();
      expect(convs).toHaveLength(1);
    });

    it('stores mcp source metadata with the session ID + owner', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('SearchDBSchema', { connection_id: 'main' }, TOOL_RESULT);
      await logger.flush();

      const [conv] = await loadMcpConversations();
      expect(conv.meta.source).toEqual({ type: 'mcp', sessionId: SESSION_ID });
      const { rows } = await getModules().db.exec<{ owner_user_id: number }>(
        'SELECT owner_user_id FROM conversations WHERE id = $1', [conv.id]);
      expect(rows[0].owner_user_id).toBe(1);
    });

    it('records the tool name + arguments in the conversation log', async () => {
      const args = { connection_id: 'analytics', query: 'SELECT revenue FROM sales' };
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('ExecuteQuery', args, TOOL_RESULT);
      await logger.flush();

      const [conv] = await loadMcpConversations();
      const logJson = JSON.stringify(await loadLog(conv.id));
      expect(logJson).toContain('ExecuteQuery');
      expect(logJson).toContain('SELECT revenue FROM sales');
    });

    it('records the tool result in the conversation log', async () => {
      const result: McpToolCallResult = { content: [{ type: 'text', text: '{"rows":[{"count":42}]}' }] };
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('ExecuteQuery', { connection_id: 'main', query: 'SELECT COUNT(*) FROM orders' }, result);
      await logger.flush();

      const [conv] = await loadMcpConversations();
      const logJson = JSON.stringify(await loadLog(conv.id));
      // The tool result rides in a toolResult entry (its text is JSON-escaped inside content).
      expect(logJson).toContain('rows');
      expect(logJson).toContain('42');
    });
  });

  describe('flush() with no tool calls', () => {
    it('does not create a conversation', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      await logger.flush();
      expect(await loadMcpConversations()).toHaveLength(0);
    });
  });

  describe('multiple tool calls in a single session', () => {
    it('logs all tool calls in one conversation, in order', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('SearchDBSchema', { connection_id: 'main', query: 'customers' }, TOOL_RESULT);
      logger.logToolCall('ExecuteQuery', { connection_id: 'main', query: 'SELECT * FROM customers LIMIT 10' }, TOOL_RESULT);
      await logger.flush();

      const convs = await loadMcpConversations();
      expect(convs).toHaveLength(1); // one conversation per session
      const log = await loadLog(convs[0].id);
      const json = JSON.stringify(log);
      expect(json).toContain('SearchDBSchema');
      expect(json).toContain('ExecuteQuery');
      // SearchDBSchema appears before ExecuteQuery (order preserved).
      expect(json.indexOf('SearchDBSchema')).toBeLessThan(json.indexOf('ExecuteQuery'));
    });
  });

  describe('error resilience', () => {
    it('flush() never throws (logging must not affect MCP responses)', async () => {
      const logger = new McpSessionLogger(SESSION_ID, TEST_USER);
      logger.logToolCall('SearchDBSchema', { connection_id: 'main' }, TOOL_RESULT);
      await expect(logger.flush()).resolves.toBeUndefined();
      await expect(logger.flush()).resolves.toBeUndefined();
    });
  });
});
