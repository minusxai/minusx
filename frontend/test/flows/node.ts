/**
 * Shared node-driver flow + verify helpers (Tests/QA/Evals Arch V2 — Phase 2).
 *
 * These collapse the repeated "build request → call route handler → parse JSON →
 * assert" boilerplate in node e2e tests into a concise, reusable vocabulary. The
 * Playwright e2e helpers mirror these names so flows read the same across drivers.
 */
import { expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as evalsPostHandler } from '@/app/api/jobs/test/route';
import type { Test, TestAnswerType, TestOperator } from '@/lib/types';

export interface EvalResult {
  passed: boolean;
  actualValue: unknown;
  expectedValue: unknown;
}

/** Run a Test through the real `/api/jobs/test` route handler; returns parsed JSON. */
export async function runEval(test: Test, connectionId = ''): Promise<EvalResult> {
  const req = new NextRequest('http://localhost:3000/api/jobs/test', {
    method: 'POST',
    body: JSON.stringify({ test, connection_id: connectionId }),
    headers: { 'Content-Type': 'application/json' },
  });
  return (await evalsPostHandler(req)).json();
}

/** A QueryResult-shaped object for `mockRunQuery.mockResolvedValue(...)`. */
export function queryRows(
  columns: string[],
  rows: Record<string, unknown>[],
  types?: string[],
): { columns: string[]; types: string[]; rows: Record<string, unknown>[] } {
  return { columns, types: types ?? columns.map(() => 'number'), rows };
}

/** Build a `query`-type Test (replaces the verbose object literal). */
export function buildQueryTest(s: {
  questionId: number;
  column?: string;
  row?: number;
  answerType?: TestAnswerType;
  op: TestOperator;
  expected: string | number | boolean;
}): Test {
  return {
    type: 'query',
    subject: { type: 'query', question_id: s.questionId, column: s.column, row: s.row },
    answerType: s.answerType ?? 'number',
    operator: s.op,
    value: { type: 'constant', value: s.expected },
  };
}

/** Build an `llm`-type Test (defaults to the explore context + binary answer). */
export function buildLlmTest(s: {
  prompt: string;
  context?: { type: 'explore' } | { type: 'file'; file_id: number };
  answerType?: TestAnswerType;
  op: TestOperator;
  expected: string | number | boolean;
}): Test {
  return {
    type: 'llm',
    subject: { type: 'llm', prompt: s.prompt, context: s.context ?? { type: 'explore' } },
    answerType: s.answerType ?? 'binary',
    operator: s.op,
    value: { type: 'constant', value: s.expected },
  };
}

/** Assert a parsed eval result. Numbers are compared with `toBeCloseTo`. */
export function expectResult(
  data: EvalResult,
  exp: { passed: boolean; actual?: unknown; expected?: unknown },
): void {
  expect(data.passed).toBe(exp.passed);
  if ('actual' in exp) {
    if (typeof exp.actual === 'number') expect(data.actualValue).toBeCloseTo(exp.actual, 4);
    else expect(data.actualValue).toBe(exp.actual);
  }
  if ('expected' in exp) expect(data.expectedValue).toBe(exp.expected);
}
