/**
 * Client-side TestRunner implementation.
 *
 * Runs Tests from browser context using existing Redux state and API routes.
 * No run file is created — results are returned inline for immediate UI feedback.
 *
 * Usage:
 *   import { createClientRunner } from '@/lib/tests/client';
 *   const runner = createClientRunner();
 *   const result = await runner.execute(test);
 */
import { readFiles, getQueryResult } from '@/lib/api/file-state';
import type { QuestionContent, Test, TestRunResult, TestValue } from '@/lib/types';
import { compareValues, extractCellValue, type TestRunner } from './index';

/**
 * Resolve a TestValue to a concrete expected value on the client.
 * For 'query' values, loads + executes the referenced question.
 */
async function resolveExpectedValueOnClient(
  value: TestValue
): Promise<string | number | boolean | null> {
  if (value.type === 'constant') {
    return value.value;
  }
  if (value.type === 'cannot_answer') {
    return null; // handled separately before this is called
  }

  const [qFile] = await readFiles([value.question_id]);
  const question = qFile?.fileState?.content as QuestionContent | undefined;
  if (!question?.query || !question.database_name) return null;

  const result = await getQueryResult({
    query: question.query,
    params: {},
    database: question.database_name,
  }, { forceLoad: true });

  return extractCellValue(result.rows, result.columns, value.column, value.row);
}

/**
 * Run a query-type Test on the client.
 */
async function executeQueryTestOnClient(
  test: Test & { type: 'query' }
): Promise<TestRunResult> {
  const subject = test.subject as Extract<typeof test.subject, { type: 'query' }>;

  const [qFile] = await readFiles([subject.question_id]);
  const question = qFile?.fileState?.content as QuestionContent | undefined;
  if (!question?.query || !question.database_name) {
    return {
      test,
      passed: false,
      error: `Question #${subject.question_id} not found or has no query/connection`,
    };
  }

  let rows: Record<string, unknown>[];
  let columns: string[];
  try {
    const result = await getQueryResult({
      query: question.query,
      params: {},
      database: question.database_name,
    }, { forceLoad: true });
    rows = result.rows;
    columns = result.columns;
  } catch (err) {
    return {
      test,
      passed: false,
      error: err instanceof Error ? err.message : 'Query execution failed',
    };
  }

  const actualValue = extractCellValue(rows, columns, subject.column, subject.row);
  const expectedValue = await resolveExpectedValueOnClient(test.value);

  if (actualValue === null) {
    return { test, passed: false, actualValue, expectedValue, error: 'Query returned no matching cell' };
  }
  if (expectedValue === null) {
    return { test, passed: false, actualValue, expectedValue, error: 'Could not resolve expected value' };
  }

  const passed = compareValues(actualValue, expectedValue, test.operator, test.answerType);
  return { test, passed, actualValue, expectedValue };
}

/**
 * Run an LLM-type Test on the client.
 * Delegates to /api/evals which runs the TestAgent loop server-side.
 * The server runner handles the full agent orchestration and returns a TestRunResult.
 */
async function executeLLMTestOnClient(
  test: Test & { type: 'llm' }
): Promise<TestRunResult> {
  try {
    const response = await fetch('/api/evals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      return { test, passed: false, error: `Eval error: ${text}` };
    }

    const result: TestRunResult = await response.json();
    return result;
  } catch (err) {
    return {
      test,
      passed: false,
      error: err instanceof Error ? err.message : 'Failed to run eval',
    };
  }
}

/**
 * Create a client-side TestRunner.
 * Uses existing Redux + API routes for all operations.
 * No new server API required.
 */
export function createClientRunner(): TestRunner {
  return {
    async execute(test: Test): Promise<TestRunResult> {
      try {
        if (test.type === 'query') {
          return executeQueryTestOnClient(test as Test & { type: 'query' });
        }
        return executeLLMTestOnClient(test as Test & { type: 'llm' });
      } catch (err) {
        return {
          test,
          passed: false,
          error: err instanceof Error ? err.message : 'Unknown error executing test',
        };
      }
    },
  };
}
