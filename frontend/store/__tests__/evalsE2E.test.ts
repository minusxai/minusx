/**
 * Evals API E2E Tests
 *
 * Drives POST /api/jobs/test with the unified `Test` format against the
 * in-process v2 EvalAnalystAgent (faux LLM). No backend to spawn — we control the
 * agent's Submit tool call, so pass/fail comparisons are deterministic.
 *
 * Run: npm test -- store/__tests__/evalsE2E.test.ts
 */

vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (_db: string, sql: string) => ({ columns: [], types: [], rows: [], finalQuery: sql })),
}));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));

import { POST as evalsPostHandler } from '@/app/api/jobs/test/route';
import { getTestDbPath } from './test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { fauxRegistration as evalFaux } from '@/agents/eval/eval-agent';
import { NextRequest } from 'next/server';
import type { Test } from '@/lib/types';

const TEST_DB_PATH = getTestDbPath('evals_e2e');

function createEvalsRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/jobs/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function llmTest(prompt: string, answerType: Test['answerType'], value: Test['value']): Test {
  return {
    type: 'llm',
    subject: { type: 'llm', prompt, context: { type: 'explore' }, connection_id: '' },
    answerType,
    operator: '=',
    value,
  };
}

function submitFaux(toolName: string, args: Record<string, unknown>): void {
  evalFaux.setResponses([
    fauxAssistantMessage([fauxToolCall(toolName, args, { id: 'sub_1' })], { stopReason: 'toolUse' }),
  ]);
}

describe('Evals API E2E Tests', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(() => evalFaux.setResponses([]));

  it('binary — SubmitBinary(true) vs expected true → passed', async () => {
    submitFaux('SubmitBinary', { answer: true });
    const test = llmTest('Is the sky blue?', 'binary', { type: 'constant', value: true });
    const data = await (await evalsPostHandler(createEvalsRequest({ test }))).json();

    expect(data.passed).toBe(true);
    expect(data.actualValue).toBe(true);
    expect(data.expectedValue).toBe(true);
    expect(data.error).toBeUndefined();
  }, 60000);

  it('binary — SubmitBinary(false) vs expected true → failed', async () => {
    submitFaux('SubmitBinary', { answer: false });
    const test = llmTest('Is the sky green?', 'binary', { type: 'constant', value: true });
    const data = await (await evalsPostHandler(createEvalsRequest({ test }))).json();

    expect(data.passed).toBe(false);
    expect(data.actualValue).toBe(false);
    expect(data.expectedValue).toBe(true);
  }, 60000);

  it('number — SubmitNumber(42) vs expected 42 → passed', async () => {
    submitFaux('SubmitNumber', { answer: 42 });
    const test = llmTest('What is 6 x 7?', 'number', { type: 'constant', value: 42 });
    const data = await (await evalsPostHandler(createEvalsRequest({ test }))).json();

    expect(data.passed).toBe(true);
    expect(data.actualValue).toBeCloseTo(42, 4);
    expect(data.expectedValue).toBe(42);
  }, 60000);

  it('number — SubmitNumber(4) vs expected 999 → failed', async () => {
    submitFaux('SubmitNumber', { answer: 4 });
    const test = llmTest('What is 2 + 2?', 'number', { type: 'constant', value: 999 });
    const data = await (await evalsPostHandler(createEvalsRequest({ test }))).json();

    expect(data.passed).toBe(false);
    expect(data.actualValue).toBeCloseTo(4, 4);
    expect(data.expectedValue).toBe(999);
  }, 60000);

  it('cannot_answer — agent calls CannotAnswer → passed', async () => {
    submitFaux('CannotAnswer', { reason: 'insufficient data' });
    const test = llmTest('Unanswerable?', 'binary', { type: 'cannot_answer' });
    const data = await (await evalsPostHandler(createEvalsRequest({ test }))).json();

    expect(data.passed).toBe(true);
  }, 60000);
});
