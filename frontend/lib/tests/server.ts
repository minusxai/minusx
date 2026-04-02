/**
 * Server-side TestRunner implementation.
 *
 * Runs Tests within a server context (Next.js API route / job handler).
 * Has direct access to the database, Python backend, and file system.
 *
 * Usage:
 *   import { createServerRunner } from '@/lib/tests/server';
 *   const runner = createServerRunner(user, defaultConnectionId);
 *   const result = await runner.execute(test);
 */
import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { orchestratePendingTools } from '@/app/api/chat/orchestrator';
import '@/app/api/chat/tool-handlers.server';
import { dbFileToCompressedAugmented } from '@/lib/api/compress-augmented';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { PythonChatResponse, CompletedToolCallPayload, CompletedToolCallFromPython } from '@/lib/chat-orchestration';
import type {
  Test,
  TestRunResult,
  TestSubject,
  TestValue,
  QuestionContent,
  ConversationLogEntry,
} from '@/lib/types';
import { compareValues, extractCellValue, type TestRunner } from './index';

/** Assertion type string sent to the Python TestAgent */
type PythonAssertionType = 'binary' | 'number_match' | 'string_match';

function answerTypeToPythonAssertion(answerType: Test['answerType']): PythonAssertionType {
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
  let database_name: string;
  if (value.source === 'inline') {
    sql = value.sql;
    database_name = value.database_name;
  } else {
    const fileResult = await FilesAPI.loadFile(value.question_id, user);
    const question = fileResult.data?.content as QuestionContent | undefined;
    if (!question?.query || !question.database_name) return null;
    sql = question.query;
    database_name = question.database_name;
  }

  const result = await runQuery(database_name, sql, {}, user);
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
    subjectDb = subject.database_name;
  } else {
    const fileResult = await FilesAPI.loadFile(subject.question_id, user);
    const question = fileResult.data?.content as QuestionContent | undefined;
    if (!question?.query || !question.database_name) {
      return {
        test,
        passed: false,
        error: `Question #${subject.question_id} not found or has no query/connection`,
      };
    }
    subjectSql = question.query;
    subjectDb = question.database_name;
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
 * Run an LLM-type Test on the server via the Python TestAgent.
 */
async function executeLLMTest(
  test: Test & { type: 'llm' },
  user: EffectiveUser,
  defaultConnectionId: string
): Promise<TestRunResult> {
  const subject = test.subject as Extract<typeof test.subject, { type: 'llm' }>;

  // Build app_state for the Python agent
  let app_state: Record<string, unknown> | null = null;
  if (subject.context.type === 'file') {
    const fileResult = await FilesAPI.loadFile(subject.context.file_id, user);
    if (fileResult.data) {
      const refs = fileResult.metadata?.references ?? [];
      app_state = { type: 'file', state: dbFileToCompressedAugmented(fileResult.data, refs) };
    }
  }

  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
  const agentArgs = {
    goal: subject.prompt,
    assertion: { type: answerTypeToPythonAssertion(test.answerType) },
    schema: [],  // no schema context for standalone test — agent uses SearchDBSchema
    context: '',
    connection_id: subject.connection_id || defaultConnectionId,
    app_state,
    home_folder: resolvedHomeFolder,
  };

  // Run the agent loop (same pattern as /api/evals route)
  let log: ConversationLogEntry[] = [];
  const allCompletedFromPython: CompletedToolCallFromPython[] = [];
  let completedToolCalls: CompletedToolCallPayload[] = [];
  let userMessage: string | null = subject.prompt;

  const DUMMY_FILE_ID = -1;
  const DUMMY_LOG_INDEX = 0;

  for (let iteration = 0; iteration < 50; iteration++) {
    const payload = {
      log,
      user_message: userMessage,
      completed_tool_calls: completedToolCalls,
      agent: 'TestAgent',
      agent_args: agentArgs,
    };

    let pythonResponse: PythonChatResponse;
    try {
      const response = await pythonBackendFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      }, user);
      if (!response.ok) {
        const errText = await response.text();
        return { test, passed: false, error: `Agent error: ${errText}`, log: allCompletedFromPython };
      }
      pythonResponse = await response.json();
    } catch (err) {
      return { test, passed: false, error: err instanceof Error ? err.message : 'Agent request failed', log: allCompletedFromPython };
    }

    allCompletedFromPython.push(...pythonResponse.completed_tool_calls);
    log = [...log, ...pythonResponse.logDiff];
    userMessage = null;

    if (pythonResponse.pending_tool_calls.length === 0) break;

    const orchResult = await orchestratePendingTools(
      pythonResponse.pending_tool_calls,
      DUMMY_FILE_ID,
      DUMMY_LOG_INDEX,
      user,
      { allowServerFallback: true }
    );
    completedToolCalls = orchResult.completedTools;
    if (orchResult.completedTools.length === 0) break;
  }

  // Find the submit call
  const submitCall = allCompletedFromPython.find(tc =>
    tc.function?.name === 'SubmitBinary' ||
    tc.function?.name === 'SubmitNumber' ||
    tc.function?.name === 'SubmitString' ||
    tc.function?.name === 'CannotAnswer'
  );

  if (!submitCall) {
    return { test, passed: false, error: 'Agent did not submit an answer', log: allCompletedFromPython };
  }

  let submitContent: Record<string, unknown> = {};
  try {
    submitContent = typeof submitCall.content === 'string'
      ? JSON.parse(submitCall.content)
      : (submitCall.content as Record<string, unknown>) || {};
  } catch {
    submitContent = {};
  }

  // cannot_answer: test passes iff agent called CannotAnswer
  if (test.value.type === 'cannot_answer') {
    const passed = submitCall.function?.name === 'CannotAnswer';
    return {
      test,
      passed,
      error: passed ? undefined : 'Agent submitted an answer instead of saying cannot answer',
      log: allCompletedFromPython,
    };
  }

  if (submitCall.function?.name === 'CannotAnswer') {
    return {
      test,
      passed: false,
      error: `Agent cannot answer: ${(submitContent.reason as string) ?? 'No reason given'}`,
      log: allCompletedFromPython,
    };
  }

  const actualValue = submitContent.answer as string | number | boolean;
  const expectedValue = await resolveExpectedValue(test.value, user);

  if (expectedValue === null) {
    return { test, passed: false, actualValue, expectedValue, error: 'Could not resolve expected value', log: allCompletedFromPython };
  }

  const passed = compareValues(actualValue, expectedValue, test.operator, test.answerType);
  return { test, passed, actualValue, expectedValue, log: allCompletedFromPython };
}

/**
 * Create a server-side TestRunner.
 *
 * @param user                The effective user (for auth + file access)
 * @param defaultConnectionId Default connection to use for LLM tests without an explicit connection
 */
export function createServerRunner(user: EffectiveUser, defaultConnectionId: string): TestRunner {
  return {
    async execute(test: Test): Promise<TestRunResult> {
      try {
        if (test.type === 'query') {
          return executeQueryTest(test as Test & { type: 'query' }, user);
        }
        return executeLLMTest(test as Test & { type: 'llm' }, user, defaultConnectionId);
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
