/**
 * Store E2E Tests — merged from testRunnerE2E and jsonAgentTests
 *
 * Suite 1 (testRunnerE2E): Test-runner comparison utilities + query/LLM test execution
 * Suite 2 (jsonAgentTests): JSON-driven agent tests against real LLM (skipped unless ANTHROPIC_API_KEY set)
 */

// Must be first — Jest hoists these above all imports
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const mockRunQuery = jest.fn();
jest.mock('@/lib/connections/run-query', () => ({
  runQuery: mockRunQuery,
}));

import * as path from 'path';
import { POST as evalsPostHandler } from '@/app/api/jobs/test/route';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { getTestDbPath } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb, addMxfoodConnection, ensureMxfoodDataset } from '@/test/harness/test-db';
import { loadAgentTestSpecs, runAgentTestSpecs } from '@/test/harness/agent-test-runner';
import { NextRequest } from 'next/server';
import {
  compareValues,
  extractCellValue,
  resolveRowIndex,
} from '@/lib/tests/index';
import type { Test } from '@/lib/types';
import { getModules } from '@/lib/modules/registry';

// ─── testRunnerE2E ────────────────────────────────────────────────────────────

const TEST_RUNNER_DB_PATH = getTestDbPath('test_runner_e2e');
// Fixed high IDs that won't collide with seed data
const Q = { total: 99001, cnt: 99002, users: 99003, status: 99004, series: 99005 };

function createEvalsRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/jobs/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('compareValues — shared utility', () => {
  describe('binary', () => {
    it('true = true → passes', () => expect(compareValues(true, true, '=', 'binary')).toBe(true));
    it('false = true → fails', () => expect(compareValues(false, true, '=', 'binary')).toBe(false));
    it('null actual → fails', () => expect(compareValues(null, true, '=', 'binary')).toBe(false));
  });

  describe('number', () => {
    it('42 = 42 → passes', () => expect(compareValues(42, 42, '=', 'number')).toBe(true));
    it('42 = 43 → fails', () => expect(compareValues(42, 43, '=', 'number')).toBe(false));
    it('10 < 20 → passes', () => expect(compareValues(10, 20, '<', 'number')).toBe(true));
    it('10 > 20 → fails', () => expect(compareValues(10, 20, '>', 'number')).toBe(false));
    it('10 <= 10 → passes', () => expect(compareValues(10, 10, '<=', 'number')).toBe(true));
    it('10 >= 10 → passes', () => expect(compareValues(10, 10, '>=', 'number')).toBe(true));
    it('string "42" = 42 → passes (coerced)', () => expect(compareValues('42', 42, '=', 'number')).toBe(true));
  });

  describe('string', () => {
    it('exact match → passes', () => expect(compareValues('hello', 'hello', '=', 'string')).toBe(true));
    it('different → fails', () => expect(compareValues('hello', 'world', '=', 'string')).toBe(false));
    it('regex match ~ → passes', () => expect(compareValues('hello world', 'hel+o', '~', 'string')).toBe(true));
    it('regex no-match ~ → fails', () => expect(compareValues('goodbye', 'hel+o', '~', 'string')).toBe(false));
  });
});

describe('extractCellValue + resolveRowIndex', () => {
  const rows = [{ a: 10, b: 'x' }, { a: 20, b: 'y' }, { a: 30, b: 'z' }];
  const cols = ['a', 'b'];

  it('row 0, default column → first row, first col', () =>
    expect(extractCellValue(rows, cols)).toBe(10));
  it('row 1, column b', () =>
    expect(extractCellValue(rows, cols, 'b', 1)).toBe('y'));
  it('row -1 (last row), column a → 30', () =>
    expect(extractCellValue(rows, cols, 'a', -1)).toBe(30));
  it('unknown column falls back to first col', () =>
    expect(extractCellValue(rows, cols, 'zzz', 0)).toBe(10));
  it('empty rows → null', () =>
    expect(extractCellValue([], cols, 'a')).toBeNull());
  it('out-of-range row → null', () =>
    expect(extractCellValue(rows, cols, 'a', 99)).toBeNull());

  it('resolveRowIndex: 0 → 0', () => expect(resolveRowIndex(rows, 0)).toBe(0));
  it('resolveRowIndex: -1 → 2 (last)', () => expect(resolveRowIndex(rows, -1)).toBe(2));
  it('resolveRowIndex: -2 → 1', () => expect(resolveRowIndex(rows, -2)).toBe(1));
  it('resolveRowIndex: undefined → 0', () => expect(resolveRowIndex(rows, undefined)).toBe(0));
  it('resolveRowIndex: empty → undefined', () => expect(resolveRowIndex([], 0)).toBeUndefined());
});

describe('Query Test Runner E2E', () => {
  setupTestDb(TEST_RUNNER_DB_PATH, {
    customInit: async () => {
      const db = getModules().db;
      const now = new Date().toISOString();
      const questions = [
        { id: Q.total,  name: 'Total Revenue', query: 'SELECT 42 AS total' },
        { id: Q.cnt,    name: 'Row Count',     query: 'SELECT 5 AS cnt' },
        { id: Q.users,  name: 'Active Users',  query: 'SELECT 100 AS users' },
        { id: Q.status, name: 'Status Check',  query: "SELECT 'active' AS status" },
        { id: Q.series, name: 'Time Series',   query: 'SELECT day, value FROM series' },
      ];
      for (const q of questions) {
        await db.exec(
          `INSERT INTO files (id,name,path,type,content,file_references,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            q.id, q.name, `/org/q/${q.id}`, 'question',
            JSON.stringify({ query: q.query, connection_name: 'default', vizSettings: { type: 'table' } }),
            '[]', now, now,
          ]
        );
      }
    },
  });

  it('query test — constant = match → passed', async () => {
    mockRunQuery.mockResolvedValue({ columns: ['total'], types: ['number'], rows: [{ total: 42 }] });
    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: Q.total, column: 'total', row: 0 },
      answerType: 'number', operator: '=',
      value: { type: 'constant', value: 42 },
    };
    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    expect(data.passed).toBe(true);
    expect(data.actualValue).toBeCloseTo(42, 4);
    expect(data.expectedValue).toBe(42);
  });

  it('query test — constant = mismatch → failed', async () => {
    mockRunQuery.mockResolvedValue({ columns: ['cnt'], types: ['number'], rows: [{ cnt: 5 }] });
    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: Q.cnt, column: 'cnt' },
      answerType: 'number', operator: '=',
      value: { type: 'constant', value: 999 },
    };
    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    expect(data.passed).toBe(false);
    expect(data.actualValue).toBeCloseTo(5, 4);
    expect(data.expectedValue).toBe(999);
  });

  it('query test — > operator passes when actual > expected', async () => {
    mockRunQuery.mockResolvedValue({ columns: ['users'], types: ['number'], rows: [{ users: 100 }] });
    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: Q.users },
      answerType: 'number', operator: '>',
      value: { type: 'constant', value: 50 },
    };
    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    expect(data.passed).toBe(true);
    expect(data.actualValue).toBeCloseTo(100, 4);
  });

  it('query test — string regex match ~ → passed', async () => {
    mockRunQuery.mockResolvedValue({ columns: ['status'], types: ['varchar'], rows: [{ status: 'active' }] });
    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: Q.status, column: 'status' },
      answerType: 'string', operator: '~',
      value: { type: 'constant', value: '^act' },
    };
    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    expect(data.passed).toBe(true);
    expect(data.actualValue).toBe('active');
  });

  it('query test — last row (-1) extraction', async () => {
    mockRunQuery.mockResolvedValue({
      columns: ['day', 'value'], types: ['varchar', 'number'],
      rows: [{ day: '2024-01-01', value: 10 }, { day: '2024-01-02', value: 20 }, { day: '2024-01-03', value: 30 }],
    });
    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: Q.series, column: 'value', row: -1 },
      answerType: 'number', operator: '=',
      value: { type: 'constant', value: 30 },
    };
    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    expect(data.passed).toBe(true);
    expect(data.actualValue).toBeCloseTo(30, 4);
  });
});

describe('LLM Test Runner E2E (mock LLM server)', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  const mockFetch = setupMockFetch({
    getPythonPort,
    getLLMMockPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler,
      },
    ],
  });

  const USAGE = { total_tokens: 50, prompt_tokens: 30, completion_tokens: 20 };

  setupTestDb(TEST_RUNNER_DB_PATH);

  beforeEach(async () => {
    await getLLMMockServer!().reset();
    mockFetch.mockClear();
  });

  it('llm binary test — SubmitBinary(true) against expected true → passed', async () => {
    await getLLMMockServer!().configure({
      response: {
        content: '', role: 'assistant',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'SubmitBinary', arguments: JSON.stringify({ answer: true }) } }],
        finish_reason: 'tool_calls',
      },
      usage: USAGE,
    });

    const test: Test = {
      type: 'llm',
      subject: { type: 'llm', prompt: 'Does the dashboard show any charts?', context: { type: 'explore' } },
      answerType: 'binary', operator: '=',
      value: { type: 'constant', value: true },
    };

    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    expect(data.passed).toBe(true);
    expect(data.actualValue).toBe(true);
    expect(data.expectedValue).toBe(true);
    expect(data.log).toBeDefined();
  }, 60000);

  it('llm binary test — SubmitBinary(false) against expected true → failed', async () => {
    await getLLMMockServer!().configure({
      response: {
        content: '', role: 'assistant',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'SubmitBinary', arguments: JSON.stringify({ answer: false }) } }],
        finish_reason: 'tool_calls',
      },
      usage: USAGE,
    });

    const test: Test = {
      type: 'llm',
      subject: { type: 'llm', prompt: 'Is the revenue chart showing an upward trend?', context: { type: 'explore' } },
      answerType: 'binary', operator: '=',
      value: { type: 'constant', value: true },
    };

    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    expect(data.passed).toBe(false);
    expect(data.actualValue).toBe(false);
    expect(data.expectedValue).toBe(true);
  }, 60000);
});

// ─── jsonAgentTests ───────────────────────────────────────────────────────────

const JSON_AGENT_DB_PATH = getTestDbPath('json_agent_tests');

(process.env.ANTHROPIC_API_KEY ? describe : describe.skip)('JSON Agent Tests', () => {
  // Guard: describe.skip still evaluates the callback body (to collect tests). Without
  // this return, setupMockFetch below would install a new fetch mock that overwrites the
  // one set up by the 'LLM Test Runner E2E' suite above, breaking its /mock/configure calls.
  if (!process.env.ANTHROPIC_API_KEY) return;

  beforeAll(async () => {
    await ensureMxfoodDataset();
  }, 60_000);

  const { getPythonPort: getJsonAgentPythonPort } = withPythonBackend();

  const { getStore } = setupTestDb(JSON_AGENT_DB_PATH, {
    customInit: async (dbPath) => {
      await addMxfoodConnection(dbPath);
    },
  });

  const jsonAgentMockFetch = setupMockFetch({
    getPythonPort: getJsonAgentPythonPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler,
      },
    ],
  });

  beforeEach(() => {
    jsonAgentMockFetch.mockClear();
  });

  const specs = loadAgentTestSpecs(path.join(__dirname, 'agent-tests/test-definitions.json'));
  runAgentTestSpecs(specs, { getStore });
});
