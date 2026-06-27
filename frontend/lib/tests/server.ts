/**
 * Server-side TestRunner implementation.
 *
 * Runs Tests within a server context (Next.js API route / job handler).
 * Has direct access to the database and file system.
 *
 * Usage:
 *   import { createServerRunner } from '@/lib/tests/server';
 *   const runner = createServerRunner(user, defaultConnectionId);
 *   const result = await runner.execute(test);
 */
import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { buildServerAgentArgs, type BuildServerAgentArgsOptions } from '@/lib/chat/agent-args.server';
import { runEvalV2 } from '@/lib/chat/run-eval-v2.server';
import { getAppStateServer } from '@/lib/api/file-state.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { EvalAssertionType } from '@/agents/eval/eval-agent';
import type {
  Test,
  TestRunResult,
  TestValue,
  QuestionContent,
} from '@/lib/types';
import { compareValues, extractCellValue, type TestRunner } from './index';

function answerTypeToAssertion(answerType: Test['answerType']): EvalAssertionType {
  if (answerType === 'binary') return 'binary';
  if (answerType === 'number') return 'number_match';
  return 'string_match';
}

/**
 * Resolve a TestValue to a concrete expected value.
 * For 'query' values, runs the referenced question and extracts the cell.
 */
async function resolveExpectedValue(
  value: TestValue,
  user: EffectiveUser
): Promise<string | number | boolean | null> {
  if (value.type === 'constant') {
    return value.value;
  }
  if (value.type === 'cannot_answer') {
    return null; // handled separately before this is called
  }

  // type: 'query' — run the question or inline SQL, extract column/row cell
  let sql: string;
  let connection_name: string;
  if (value.source === 'inline') {
    sql = value.sql;
    connection_name = value.connection_name;
  } else {
    const fileResult = await FilesAPI.loadFile(value.question_id, user);
    const question = fileResult.data?.content as QuestionContent | undefined;
    if (!question?.query || !question.connection_name) return null;
    sql = question.query;
    connection_name = question.connection_name;
  }

  const result = await runQuery(connection_name, sql, {}, user);
  if (!result.rows.length) return null;
  return extractCellValue(result.rows, result.columns, value.column, value.row);
}

/**
 * Run a query-type Test on the server.
 */
async function executeQueryTest(
  test: Test & { type: 'query' },
  user: EffectiveUser
): Promise<TestRunResult> {
  const subject = test.subject as Extract<typeof test.subject, { type: 'query' }>;

  // Load and run the subject question or inline SQL
  let subjectSql: string;
  let subjectDb: string;
  if (subject.source === 'inline') {
    subjectSql = subject.sql;
    subjectDb = subject.connection_name;
  } else {
    const fileResult = await FilesAPI.loadFile(subject.question_id, user);
    const question = fileResult.data?.content as QuestionContent | undefined;
    if (!question?.query || !question.connection_name) {
      return {
        test,
        passed: false,
        error: `Question #${subject.question_id} not found or has no query/connection`,
      };
    }
    subjectSql = question.query;
    subjectDb = question.connection_name;
  }

  let rows: Record<string, unknown>[];
  let columns: string[];
  try {
    const result = await runQuery(subjectDb, subjectSql, {}, user);
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
  const expectedValue = await resolveExpectedValue(test.value, user);

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
 * Run an LLM-type Test on the server via the in-process v2 EvalAnalystAgent.
 */
async function executeLLMTest(
  test: Test & { type: 'llm' },
  user: EffectiveUser,
  defaultConnectionId: string,
  options?: BuildServerAgentArgsOptions
): Promise<TestRunResult> {
  const subject = test.subject as Extract<typeof test.subject, { type: 'llm' }>;

  // Build app_state (executeQueries: true so the agent has query results available).
  let app_state: Record<string, unknown> | null = null;
  if (subject.context.type === 'file') {
    app_state = await getAppStateServer(subject.context.file_id, user, { executeQueries: true });
  }

  const baseArgs = await buildServerAgentArgs(user, options);

  const submission = await runEvalV2({
    goal: subject.prompt,
    assertionType: answerTypeToAssertion(test.answerType),
    schema: baseArgs.schema,
    resolvedContextDocs: baseArgs.context_docs,
    connectionId: subject.connection_id || defaultConnectionId || baseArgs.connection_id,
    appState: app_state,
    user,
  });

  if (!submission) {
    return { test, passed: false, error: 'Agent did not submit an answer' };
  }

  // cannot_answer: test passes iff agent called CannotAnswer
  if (test.value.type === 'cannot_answer') {
    const passed = submission.toolName === 'CannotAnswer';
    return {
      test,
      passed,
      error: passed ? undefined : 'Agent submitted an answer instead of saying cannot answer',
    };
  }

  if (submission.toolName === 'CannotAnswer') {
    return {
      test,
      passed: false,
      error: `Agent cannot answer: ${(submission.content.reason as string) ?? 'No reason given'}`,
    };
  }

  const actualValue = submission.content.answer as string | number | boolean;
  const expectedValue = await resolveExpectedValue(test.value, user);

  if (expectedValue === null) {
    return { test, passed: false, actualValue, expectedValue, error: 'Could not resolve expected value' };
  }

  const passed = compareValues(actualValue, expectedValue, test.operator, test.answerType);
  return { test, passed, actualValue, expectedValue };
}

/**
 * Create a server-side TestRunner.
 *
 * @param user                The effective user (for auth + file access)
 * @param defaultConnectionId Default connection to use for LLM tests without an explicit connection
 * @param options             Optional agent args overrides (e.g. contextFileId for context eval jobs)
 */
export function createServerRunner(
  user: EffectiveUser,
  defaultConnectionId: string,
  options?: BuildServerAgentArgsOptions
): TestRunner {
  return {
    async execute(test: Test): Promise<TestRunResult> {
      try {
        if (test.type === 'query') {
          return executeQueryTest(test as Test & { type: 'query' }, user);
        }
        return executeLLMTest(test as Test & { type: 'llm' }, user, defaultConnectionId, options);
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
