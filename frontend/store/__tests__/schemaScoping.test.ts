/**
 * E2E tests for SearchDBSchema context-whitelist scoping
 *
 * The whitelisted schema is already in agent_args.schema (built by ChatInterface
 * from useContext → getWhitelistedSchemaForUser). The Python agent injects it into
 * every SearchDBSchema call; the Next.js handler filters the connection schema to
 * only those tables before searching.
 *
 * Red/Green flow:
 *  - Before implementation: Turn 2 validateRequest sees all tables → FAIL
 *  - After implementation: Turn 2 validateRequest sees only whitelisted table → PASS
 *
 * Run: npm test -- store/__tests__/schemaScoping.test.ts
 */

import {
  createConversation,
  sendMessage,
  selectConversation
} from '../chatSlice';
import type { RootState } from '../store';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { waitFor, getTestDbPath } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// ─── Fixture ─────────────────────────────────────────────────────────────────

const CONN_ID = 'scoping_conn';

/** All tables the connection exposes — only 'orders' is in the whitelisted schema */
const ALL_TABLES = ['orders', 'customers', 'products'];

async function addScopingFixtures(dbPath: string) {
  const { getModules } = await import('@/lib/modules/registry');
  const db = getModules().db;
  const now = new Date().toISOString();

  const nextId = async () => {
    const r = await db.exec<{ n: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS n FROM files`, []
    );
    return r.rows[0].n;
  };

  await db.exec(
    `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      await nextId(), CONN_ID,
      `/org/database/${CONN_ID}`,
      'connection',
      JSON.stringify({
        id: CONN_ID,
        name: CONN_ID,
        type: 'duckdb',
        config: { file_path: 'nonexistent.duckdb' },
        schema: {
          updated_at: now,
          schemas: [{
            schema: 'main',
            tables: ALL_TABLES.map(t => ({ table: t, columns: [{ name: 'id', type: 'INTEGER' }] }))
          }]
        }
      }),
      '[]', now, now
    ]
  );

  // adapter is the singleton, don't close
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SearchDBSchema - Context Whitelist Scoping', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  const { getStore } = setupTestDb(getTestDbPath('schema_scoping'), {
    customInit: addScopingFixtures
  });
  const mockFetch = setupMockFetch({
    getPythonPort,
    getLLMMockPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler
      }
    ]
  });

  beforeEach(async () => {
    await getLLMMockServer!().reset();
    mockFetch.mockClear();
  });

  // ── Test 1: schema in agent_args → only whitelisted tables returned ─────────
  it('should scope SearchDBSchema to whitelisted tables when schema is in agent_args', async () => {
    const store = getStore();
    const conversationID = -501;

    await getLLMMockServer!().configure([
      // Turn 1: LLM calls SearchDBSchema (Python injects schema → handler filters)
      {
        response: {
          content: 'Let me check the tables.',
          role: 'assistant',
          tool_calls: [{
            id: 'call_scope_1',
            type: 'function',
            function: {
              name: 'SearchDBSchema',
              arguments: JSON.stringify({ connection_id: CONN_ID, query: '$[*].tables[*].table' })
            }
          }],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 60, completion_tokens: 40 }
      },
      // Turn 2: assert the tool result only contains 'orders'
      {
        validateRequest: (req: any) => {
          const toolMsg = req.messages[3];
          expect(toolMsg.role).toBe('tool');
          const content = typeof toolMsg.content === 'string'
            ? toolMsg.content : JSON.stringify(toolMsg.content);
          expect(content).toContain('orders');
          expect(content).not.toContain('customers');
          expect(content).not.toContain('products');
          return true;
        },
        response: {
          content: "Only 'orders' is available.",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 80, prompt_tokens: 60, completion_tokens: 20 }
      }
    ]);

    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: {
        goal: 'List tables',
        connection_id: CONN_ID,
        // schema = whitelisted tables (as ChatInterface sends from useContext)
        schema: [{ schema: 'main', tables: ['orders'] }]
      }
    }));
    store.dispatch(sendMessage({ conversationID, message: 'List tables' }));

    let realId = conversationID;
    await waitFor(() => {
      const tmp = selectConversation(store.getState() as RootState, conversationID);
      if (tmp?.forkedConversationID) realId = tmp.forkedConversationID;
      return selectConversation(store.getState() as RootState, realId)?.executionState === 'FINISHED';
    }, 45000);

    expect(selectConversation(store.getState() as RootState, realId)?.error).toBeUndefined();
  }, 45000);

  // ── Test 2: no schema → full connection schema returned ──────────────────────
  it('should return full schema when no schema is in agent_args', async () => {
    const store = getStore();
    const conversationID = -502;

    await getLLMMockServer!().configure([
      {
        response: {
          content: 'Let me check.',
          role: 'assistant',
          tool_calls: [{
            id: 'call_full_1',
            type: 'function',
            function: {
              name: 'SearchDBSchema',
              arguments: JSON.stringify({ connection_id: CONN_ID, query: '$[*].tables[*].table' })
            }
          }],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 60, completion_tokens: 40 }
      },
      {
        validateRequest: (req: any) => {
          const toolMsg = req.messages[3];
          const content = typeof toolMsg.content === 'string'
            ? toolMsg.content : JSON.stringify(toolMsg.content);
          expect(content).toContain('orders');
          expect(content).toContain('customers');
          expect(content).toContain('products');
          return true;
        },
        response: {
          content: 'All three tables are available.',
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 80, prompt_tokens: 60, completion_tokens: 20 }
      }
    ]);

    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: {
        goal: 'List tables',
        connection_id: CONN_ID
        // no schema → full schema
      }
    }));
    store.dispatch(sendMessage({ conversationID, message: 'List tables' }));

    let realId = conversationID;
    await waitFor(() => {
      const tmp = selectConversation(store.getState() as RootState, conversationID);
      if (tmp?.forkedConversationID) realId = tmp.forkedConversationID;
      return selectConversation(store.getState() as RootState, realId)?.executionState === 'FINISHED';
    }, 45000);

    expect(selectConversation(store.getState() as RootState, realId)?.error).toBeUndefined();
  }, 45000);
});
