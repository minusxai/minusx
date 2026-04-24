/**
 * Evals API E2E Tests
 *
 * Uses LLM mock server so tests are fully deterministic — we control exactly what
 * tool calls the agent makes, so pass/fail comparisons are predictable.
 *
 * Architecture:
 *   LLM Mock Server → Python (TestAgent) → /api/evals route → comparison logic
 *
 * Run: npm test -- store/__tests__/evalsE2E.test.ts
 */

import { POST as evalsPostHandler } from '@/app/api/jobs/test/route';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { getTestDbPath } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';
import type { EvalItem } from '@/lib/types';

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const TEST_DB_PATH = getTestDbPath('evals_e2e');

function createEvalsRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/jobs/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const USAGE = { total_tokens: 50, prompt_tokens: 30, completion_tokens: 20 };

describe('Evals API E2E Tests', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
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
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    await getLLMMockServer!().reset();
    mockFetch.mockClear();
  });

  // ---------------------------------------------------------------------------
  // Binary assertion
  // ---------------------------------------------------------------------------

  it('binary — SubmitBinary(true) against expected true → passed', async () => {
    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'SubmitBinary', arguments: JSON.stringify({ answer: true }) } }],
        finish_reason: 'tool_calls',
      },
      usage: USAGE,
    });

    const evalItem: EvalItem = {
      question: 'Is the sky blue?',
      assertion: { type: 'binary', answer: true },
      app_state: { type: 'explore' },
    };

    const data = await (await evalsPostHandler(createEvalsRequest({ eval_item: evalItem, schema: [], documentation: '', connection_id: '' }))).json();
    console.log('binary pass:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(true);
    expect(data.details.submitted).toBe(true);
    expect(data.details.expected).toBe(true);
    expect(data.log).toBeDefined();
    expect(data.error).toBeUndefined();
  }, 60000);

  it('binary — SubmitBinary(false) against expected true → failed', async () => {
    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'SubmitBinary', arguments: JSON.stringify({ answer: false }) } }],
        finish_reason: 'tool_calls',
      },
      usage: USAGE,
    });

    const evalItem: EvalItem = {
      question: 'Is the sky green?',
      assertion: { type: 'binary', answer: true },
      app_state: { type: 'explore' },
    };

    const data = await (await evalsPostHandler(createEvalsRequest({ eval_item: evalItem, schema: [], documentation: '', connection_id: '' }))).json();
    console.log('binary fail:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(false);
    expect(data.details.submitted).toBe(false);
    expect(data.details.expected).toBe(true);
  }, 60000);

  // ---------------------------------------------------------------------------
  // number_match assertion
  // ---------------------------------------------------------------------------

  it('number_match — SubmitNumber(42) against expected 42 → passed', async () => {
    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'SubmitNumber', arguments: JSON.stringify({ answer: 42 }) } }],
        finish_reason: 'tool_calls',
      },
      usage: USAGE,
    });

    const evalItem: EvalItem = {
      question: 'What is 6 × 7?',
      assertion: { type: 'number_match', answer: 42 },
      app_state: { type: 'explore' },
    };

    const data = await (await evalsPostHandler(createEvalsRequest({ eval_item: evalItem, schema: [], documentation: '', connection_id: '' }))).json();
    console.log('number_match pass:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(true);
    expect(data.details.submitted).toBeCloseTo(42, 4);
    expect(data.details.expected).toBe(42);
    expect(data.log).toBeDefined();
  }, 60000);

  it('number_match — SubmitNumber(4) against expected 999 → failed', async () => {
    await getLLMMockServer!().configure({
      response: {
        content: '',
        role: 'assistant',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'SubmitNumber', arguments: JSON.stringify({ answer: 4 }) } }],
        finish_reason: 'tool_calls',
      },
      usage: USAGE,
    });

    const evalItem: EvalItem = {
      question: 'What is 2 + 2?',
      assertion: { type: 'number_match', answer: 999 },
      app_state: { type: 'explore' },
    };

    const data = await (await evalsPostHandler(createEvalsRequest({ eval_item: evalItem, schema: [], documentation: '', connection_id: '' }))).json();
    console.log('number_match fail:', JSON.stringify(data, null, 2));

    expect(data.passed).toBe(false);
    expect(data.details.submitted).toBeCloseTo(4, 4);
    expect(data.details.expected).toBe(999);
  }, 60000);
});
