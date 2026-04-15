/**
 * Test Runner E2E Tests
 *
 * Tests for the unified Test runner (lib/tests/server.ts), exercised via
 * the POST /api/evals route with the new `test` body field.
 *
 * Three suites:
 *  1. Unit tests for shared comparison utilities (pure, no I/O)
 *  2. Query-type test end-to-end (FilesAPI + runQuery mocked)
 *  3. LLM-type test end-to-end (LLM mock server)
 *
 * Run: npm test -- store/__tests__/testRunnerE2E.test.ts
 */

// Must be first — Jest hoists this above imports
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_test_runner_e2e.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
  };
});

const mockLoadFile = jest.fn();
jest.mock('@/lib/data/files.server', () => ({
  FilesAPI: { loadFile: mockLoadFile },
  loadFile: mockLoadFile,
}));

const mockRunQuery = jest.fn();
jest.mock('@/lib/connections/run-query', () => ({
  runQuery: mockRunQuery,
}));

import { POST as evalsPostHandler } from '@/app/api/jobs/test/route';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { NextRequest } from 'next/server';
import {
  compareValues,
  extractCellValue,
  resolveRowIndex,
} from '@/lib/tests/index';
import type { Test } from '@/lib/types';

const TEST_DB_PATH = getTestDbPath('test_runner_e2e');

function createEvalsRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/jobs/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// 1. Comparison utility unit tests
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 2. Query-type test end-to-end
// ---------------------------------------------------------------------------

describe('Query Test Runner E2E (FilesAPI + runQuery mocked)', () => {
  beforeEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    await initTestDatabase(TEST_DB_PATH);
    mockLoadFile.mockClear();
    mockRunQuery.mockClear();
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  it('query test — constant = match → passed', async () => {
    // Mock the subject question (question_id: 1) returning a single row with value 42
    mockLoadFile.mockResolvedValue({
      data: {
        id: 1,
        name: 'Total Revenue',
        type: 'question',
        content: { query: 'SELECT 42 AS total', connection_name: 'default' },
      },
    });
    mockRunQuery.mockResolvedValue({
      columns: ['total'],
      types: ['number'],
      rows: [{ total: 42 }],
    });

    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: 1, column: 'total', row: 0 },
      answerType: 'number',
      operator: '=',
      value: { type: 'constant', value: 42 },
    };

    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    console.log('query = match:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(true);
    expect(data.actualValue).toBeCloseTo(42, 4);
    expect(data.expectedValue).toBe(42);
  });

  it('query test — constant = mismatch → failed', async () => {
    mockLoadFile.mockResolvedValue({
      data: {
        id: 2,
        name: 'Row Count',
        type: 'question',
        content: { query: 'SELECT 5 AS cnt', connection_name: 'default' },
      },
    });
    mockRunQuery.mockResolvedValue({
      columns: ['cnt'],
      types: ['number'],
      rows: [{ cnt: 5 }],
    });

    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: 2, column: 'cnt' },
      answerType: 'number',
      operator: '=',
      value: { type: 'constant', value: 999 },
    };

    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    console.log('query = mismatch:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(false);
    expect(data.actualValue).toBeCloseTo(5, 4);
    expect(data.expectedValue).toBe(999);
  });

  it('query test — > operator passes when actual > expected', async () => {
    mockLoadFile.mockResolvedValue({
      data: {
        id: 3,
        name: 'Active Users',
        type: 'question',
        content: { query: 'SELECT 100 AS users', connection_name: 'default' },
      },
    });
    mockRunQuery.mockResolvedValue({
      columns: ['users'],
      types: ['number'],
      rows: [{ users: 100 }],
    });

    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: 3 },
      answerType: 'number',
      operator: '>',
      value: { type: 'constant', value: 50 },
    };

    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    console.log('query > operator:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(true);
    expect(data.actualValue).toBeCloseTo(100, 4);
  });

  it('query test — string regex match ~ → passed', async () => {
    mockLoadFile.mockResolvedValue({
      data: {
        id: 4,
        name: 'Status Check',
        type: 'question',
        content: { query: "SELECT 'active' AS status", connection_name: 'default' },
      },
    });
    mockRunQuery.mockResolvedValue({
      columns: ['status'],
      types: ['varchar'],
      rows: [{ status: 'active' }],
    });

    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: 4, column: 'status' },
      answerType: 'string',
      operator: '~',
      value: { type: 'constant', value: '^act' },
    };

    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    console.log('query ~ regex:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(true);
    expect(data.actualValue).toBe('active');
  });

  it('query test — last row (-1) extraction', async () => {
    mockLoadFile.mockResolvedValue({
      data: {
        id: 5,
        name: 'Time Series',
        type: 'question',
        content: { query: 'SELECT day, value FROM series', connection_name: 'default' },
      },
    });
    mockRunQuery.mockResolvedValue({
      columns: ['day', 'value'],
      types: ['varchar', 'number'],
      rows: [
        { day: '2024-01-01', value: 10 },
        { day: '2024-01-02', value: 20 },
        { day: '2024-01-03', value: 30 },
      ],
    });

    const test: Test = {
      type: 'query',
      subject: { type: 'query', question_id: 5, column: 'value', row: -1 },
      answerType: 'number',
      operator: '=',
      value: { type: 'constant', value: 30 },
    };

    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    console.log('query last row:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(true);
    expect(data.actualValue).toBeCloseTo(30, 4);
  });
});

// ---------------------------------------------------------------------------
// 3. LLM-type test end-to-end (mock LLM server)
// ---------------------------------------------------------------------------

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

  beforeEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    await initTestDatabase(TEST_DB_PATH);
    await getLLMMockServer!().reset();
    mockFetch.mockClear();
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  it('llm binary test — SubmitBinary(true) against expected true → passed', async () => {
    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'SubmitBinary', arguments: JSON.stringify({ answer: true }) },
          },
        ],
        finish_reason: 'tool_calls',
      },
      usage: USAGE,
    });

    const test: Test = {
      type: 'llm',
      subject: {
        type: 'llm',
        prompt: 'Does the dashboard show any charts?',
        context: { type: 'explore' },
      },
      answerType: 'binary',
      operator: '=',
      value: { type: 'constant', value: true },
    };

    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    console.log('llm binary pass:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(true);
    expect(data.actualValue).toBe(true);
    expect(data.expectedValue).toBe(true);
    expect(data.log).toBeDefined();
  }, 60000);

  it('llm binary test — SubmitBinary(false) against expected true → failed', async () => {
    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'SubmitBinary', arguments: JSON.stringify({ answer: false }) },
          },
        ],
        finish_reason: 'tool_calls',
      },
      usage: USAGE,
    });

    const test: Test = {
      type: 'llm',
      subject: {
        type: 'llm',
        prompt: 'Is the revenue chart showing an upward trend?',
        context: { type: 'explore' },
      },
      answerType: 'binary',
      operator: '=',
      value: { type: 'constant', value: true },
    };

    const resp = await evalsPostHandler(createEvalsRequest({ test, connection_id: '' }));
    const data = await resp.json();
    console.log('llm binary fail:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(false);
    expect(data.actualValue).toBe(false);
    expect(data.expectedValue).toBe(true);
  }, 60000);
});
