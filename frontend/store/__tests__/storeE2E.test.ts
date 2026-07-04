/**
 * Store E2E Tests — merged from testRunnerE2E and jsonAgentTests
 *
 * Suite 1 (testRunnerE2E): Test-runner comparison utilities + query/LLM test execution
 * Suite 2 (jsonAgentTests): JSON-driven agent tests against real LLM (skipped unless ANTHROPIC_API_KEY set)
 */

// Must be first — Jest hoists these above all imports

const { mockRunQuery } = vi.hoisted(() => ({ mockRunQuery: vi.fn() }));
vi.mock('@/lib/connections/run-query', () => ({
  runQuery: mockRunQuery,
}));

import { getTestDbPath } from './test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { fauxAssistantMessage, fauxToolCall, setFauxMatches, respondTo } from '@/orchestrator/llm/testing';
import { fauxRegistration as evalFaux } from '@/agents/eval/eval-agent';
import {
  compareValues,
  extractCellValue,
  resolveRowIndex,
} from '@/lib/tests/index';
import { runEval, buildQueryTest, buildLlmTest, expectResult, queryRows } from '@/test/flows/node';
import { getModules } from '@/lib/modules/registry';

// ─── testRunnerE2E ────────────────────────────────────────────────────────────

const TEST_RUNNER_DB_PATH = getTestDbPath('test_runner_e2e');
// Fixed high IDs that won't collide with seed data
const Q = { total: 99001, cnt: 99002, users: 99003, status: 99004, series: 99005 };

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
    mockRunQuery.mockResolvedValue(queryRows(['total'], [{ total: 42 }]));
    const data = await runEval(buildQueryTest({ questionId: Q.total, column: 'total', row: 0, op: '=', expected: 42 }));
    expectResult(data, { passed: true, actual: 42, expected: 42 });
  });

  it('query test — constant = mismatch → failed', async () => {
    mockRunQuery.mockResolvedValue(queryRows(['cnt'], [{ cnt: 5 }]));
    const data = await runEval(buildQueryTest({ questionId: Q.cnt, column: 'cnt', op: '=', expected: 999 }));
    expectResult(data, { passed: false, actual: 5, expected: 999 });
  });

  it('query test — > operator passes when actual > expected', async () => {
    mockRunQuery.mockResolvedValue(queryRows(['users'], [{ users: 100 }]));
    const data = await runEval(buildQueryTest({ questionId: Q.users, op: '>', expected: 50 }));
    expectResult(data, { passed: true, actual: 100 });
  });

  it('query test — string regex match ~ → passed', async () => {
    mockRunQuery.mockResolvedValue(queryRows(['status'], [{ status: 'active' }], ['varchar']));
    const data = await runEval(
      buildQueryTest({ questionId: Q.status, column: 'status', answerType: 'string', op: '~', expected: '^act' }),
    );
    expectResult(data, { passed: true, actual: 'active' });
  });

  it('query test — last row (-1) extraction', async () => {
    mockRunQuery.mockResolvedValue(
      queryRows(
        ['day', 'value'],
        [{ day: '2024-01-01', value: 10 }, { day: '2024-01-02', value: 20 }, { day: '2024-01-03', value: 30 }],
        ['varchar', 'number'],
      ),
    );
    const data = await runEval(buildQueryTest({ questionId: Q.series, column: 'value', row: -1, op: '=', expected: 30 }));
    expectResult(data, { passed: true, actual: 30 });
  });
});

describe('LLM Test Runner E2E (in-process v2 eval agent)', () => {
  setupTestDb(TEST_RUNNER_DB_PATH);

  beforeEach(() => evalFaux.setResponses([]));

  /** Faux SubmitBinary keyed on the eval prompt (content-keyed matcher). */
  function submitBinary(prompt: string, answer: boolean): void {
    setFauxMatches(evalFaux, [
      respondTo(prompt, fauxAssistantMessage([fauxToolCall('SubmitBinary', { answer }, { id: 'sub_1' })], {
        stopReason: 'toolUse',
      })),
    ]);
  }

  it('llm binary test — SubmitBinary(true) against expected true → passed', async () => {
    const prompt = 'Does the dashboard show any charts?';
    submitBinary(prompt, true);
    const data = await runEval(buildLlmTest({ prompt, op: '=', expected: true }));
    expectResult(data, { passed: true, actual: true, expected: true });
  }, 60000);

  it('llm binary test — SubmitBinary(false) against expected true → failed', async () => {
    const prompt = 'Is the revenue chart showing an upward trend?';
    submitBinary(prompt, false);
    const data = await runEval(buildLlmTest({ prompt, op: '=', expected: true }));
    expectResult(data, { passed: false, actual: false, expected: true });
  }, 60000);
});

