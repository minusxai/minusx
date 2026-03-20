/**
 * Evals API E2E Tests
 *
 * Tests the /api/evals route handler with real Python backend orchestration.
 * Covers both SubmitBinary (binary assertion) and SubmitNumber (number_match assertion).
 *
 * Run: npm test -- store/__tests__/evalsE2E.test.ts
 */

import { POST as evalsPostHandler } from '@/app/api/evals/route';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { NextRequest } from 'next/server';
import type { EvalItem } from '@/lib/types';

function createEvalsRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/evals', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_evals_e2e.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

const TEST_DB_PATH = getTestDbPath('evals_e2e');

describe('Evals API E2E Tests', () => {
  const { getPythonPort } = withPythonBackend();
  const mockFetch = setupMockFetch({
    getPythonPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler
      }
    ]
  });

  beforeEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    await initTestDatabase(TEST_DB_PATH);
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  it('binary assertion — agent calls SubmitBinary and result is compared correctly', async () => {
    const evalItem: EvalItem = {
      question: 'Is the number 1 + 1 equal to 2? Answer with SubmitBinary(answer=True).',
      assertion: { type: 'binary', answer: true },
      app_state: { type: 'explore' },
    };

    const request = createEvalsRequest({
      eval_item: evalItem,
      schema: [],
      documentation: '',
      connection_id: '',
    });

    const response = await evalsPostHandler(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    console.log('binary eval response:', JSON.stringify(data, null, 2));

    // Agent should have called SubmitBinary and returned a pass/fail verdict
    expect(typeof data.passed).toBe('boolean');
    expect(data.details).toBeDefined();
    // The agent should answer True for "1+1=2", so it should pass
    expect(data.passed).toBe(true);
  }, 120000);

  it('number_match assertion — agent calls SubmitNumber and result is compared with tolerance', async () => {
    const evalItem: EvalItem = {
      question: 'What is 6 multiplied by 7? Call SubmitNumber(answer=42) with your answer.',
      assertion: { type: 'number_match', answer: 42 },
      app_state: { type: 'explore' },
    };

    const request = createEvalsRequest({
      eval_item: evalItem,
      schema: [],
      documentation: '',
      connection_id: '',
    });

    const response = await evalsPostHandler(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    console.log('number_match eval response:', JSON.stringify(data, null, 2));

    expect(typeof data.passed).toBe('boolean');
    expect(data.details).toBeDefined();
    // The agent should submit 42 and |42 - 42| < 0.0001, so it should pass
    expect(data.passed).toBe(true);
    expect(data.details.submitted).toBeCloseTo(42, 4);
    expect(data.details.expected).toBe(42);
  }, 120000);

  it('number_match assertion — fails when submitted value differs from expected', async () => {
    const evalItem: EvalItem = {
      question: 'What is 2 + 2? Call SubmitNumber(answer=4) with your answer.',
      assertion: { type: 'number_match', answer: 999 },  // Wrong expected — will fail
      app_state: { type: 'explore' },
    };

    const request = createEvalsRequest({
      eval_item: evalItem,
      schema: [],
      documentation: '',
      connection_id: '',
    });

    const response = await evalsPostHandler(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    console.log('number_match fail response:', JSON.stringify(data, null, 2));

    expect(typeof data.passed).toBe('boolean');
    // Agent submits 4 but expected is 999 → should fail
    expect(data.passed).toBe(false);
  }, 120000);
});
