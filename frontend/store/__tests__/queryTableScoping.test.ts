/**
 * E2E tests for ExecuteQuery context-whitelist table validation
 *
 * The Python agent injects _schema into every ExecuteQuery call.
 * ExecuteQuery.run() validates the SQL against the whitelist using SQLGlot
 * before raising UserInputException — blocked queries return an error to the LLM
 * without ever reaching Next.js/DuckDB.
 *
 * Red/Green flow:
 *  - Before implementation: blocked query executes (or fails for wrong reason)
 *  - After implementation: Turn 2 validateRequest sees error mentioning the blocked table
 *
 * Run: npm test -- store/__tests__/queryTableScoping.test.ts
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

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_query_table_scoping.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

// ─── Fixture ─────────────────────────────────────────────────────────────────

const CONN_ID = 'scoping_conn';
const ALL_TABLES = ['orders', 'customers', 'products'];

async function addScopingFixtures(dbPath: string) {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
  const now = new Date().toISOString();

  const nextId = async () => {
    const r = await db.query<{ n: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS n FROM files WHERE company_id = $1`, [1]
    );
    return r.rows[0].n;
  };

  await db.query(
    `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      1, await nextId(), CONN_ID,
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

  await db.close();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ExecuteQuery - Context Whitelist Table Validation', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  const { getStore } = setupTestDb(getTestDbPath('query_table_scoping'), {
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

  // ── Test 1: query references non-whitelisted table → blocked ─────────────
  it('should block ExecuteQuery when query references a non-whitelisted table', async () => {
    const store = getStore();
    const conversationID = -601;

    await getLLMMockServer!().configure([
      // Turn 1: LLM tries to query customers (not in whitelist)
      {
        response: {
          content: 'Let me query the data.',
          role: 'assistant',
          tool_calls: [{
            id: 'call_exec_1',
            type: 'function',
            function: {
              name: 'ExecuteQuery',
              arguments: JSON.stringify({
                query: 'SELECT * FROM customers',
                connectionId: CONN_ID
              })
            }
          }],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 60, completion_tokens: 40 }
      },
      // Turn 2: assert tool result is an error mentioning 'customers'
      {
        validateRequest: (req: any) => {
          const toolMsg = req.messages[3];
          expect(toolMsg.role).toBe('tool');
          const content = typeof toolMsg.content === 'string'
            ? toolMsg.content : JSON.stringify(toolMsg.content);
          expect(content).toContain('customers');
          expect(JSON.parse(content).success).toBe(false);
          return true;
        },
        response: {
          content: "I cannot query that table.",
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
        goal: 'Query customers',
        connection_id: CONN_ID,
        schema: [{ schema: 'main', tables: ['orders'] }]
      }
    }));
    store.dispatch(sendMessage({ conversationID, message: 'Query customers' }));

    let realId = conversationID;
    await waitFor(() => {
      const tmp = selectConversation(store.getState() as RootState, conversationID);
      if (tmp?.forkedConversationID) realId = tmp.forkedConversationID;
      return selectConversation(store.getState() as RootState, realId)?.executionState === 'FINISHED';
    }, 45000);

    expect(selectConversation(store.getState() as RootState, realId)?.error).toBeUndefined();
  }, 45000);

  // ── Test 2: query references whitelisted table → passes validation ────────
  it('should allow ExecuteQuery when query references only whitelisted tables', async () => {
    const store = getStore();
    const conversationID = -602;

    await getLLMMockServer!().configure([
      {
        response: {
          content: 'Let me query orders.',
          role: 'assistant',
          tool_calls: [{
            id: 'call_exec_2',
            type: 'function',
            function: {
              name: 'ExecuteQuery',
              arguments: JSON.stringify({
                query: 'SELECT * FROM orders',
                connectionId: CONN_ID
              })
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
          // Validation passed — result is NOT a whitelist block
          // (DuckDB may still fail since the DB file doesn't exist, that's OK)
          expect(content).not.toContain('outside the allowed schema');
          return true;
        },
        response: {
          content: 'Query executed.',
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
        goal: 'Query orders',
        connection_id: CONN_ID,
        schema: [{ schema: 'main', tables: ['orders'] }]
      }
    }));
    store.dispatch(sendMessage({ conversationID, message: 'Query orders' }));

    let realId = conversationID;
    await waitFor(() => {
      const tmp = selectConversation(store.getState() as RootState, conversationID);
      if (tmp?.forkedConversationID) realId = tmp.forkedConversationID;
      return selectConversation(store.getState() as RootState, realId)?.executionState === 'FINISHED';
    }, 45000);

    expect(selectConversation(store.getState() as RootState, realId)?.error).toBeUndefined();
  }, 45000);

  // ── Test 3: no schema → validation skipped, query proceeds ───────────────
  it('should skip validation when no schema is in agent_args', async () => {
    const store = getStore();
    const conversationID = -603;

    await getLLMMockServer!().configure([
      {
        response: {
          content: 'Querying.',
          role: 'assistant',
          tool_calls: [{
            id: 'call_exec_3',
            type: 'function',
            function: {
              name: 'ExecuteQuery',
              arguments: JSON.stringify({
                query: 'SELECT * FROM customers',
                connectionId: CONN_ID
              })
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
          // No whitelist → not a whitelist block error
          expect(content).not.toContain('outside the allowed schema');
          return true;
        },
        response: {
          content: 'Done.',
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
        goal: 'Query customers',
        connection_id: CONN_ID
        // no schema → no validation
      }
    }));
    store.dispatch(sendMessage({ conversationID, message: 'Query customers' }));

    let realId = conversationID;
    await waitFor(() => {
      const tmp = selectConversation(store.getState() as RootState, conversationID);
      if (tmp?.forkedConversationID) realId = tmp.forkedConversationID;
      return selectConversation(store.getState() as RootState, realId)?.executionState === 'FINISHED';
    }, 45000);

    expect(selectConversation(store.getState() as RootState, realId)?.error).toBeUndefined();
  }, 45000);
});
