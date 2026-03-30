import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { DocumentDB } from '@/lib/database/documents-db';
import { runQuery } from '@/lib/connections/run-query';
import { createServerRunner } from '@/lib/tests/server';
import { EvalItem, BinaryAssertion, NumberAssertion, DatabaseWithSchema, QuestionContent, ConversationLogEntry, Test } from '@/lib/types';
import { orchestratePendingTools } from '@/app/api/chat/orchestrator';
import '@/app/api/chat/tool-handlers.server';
import type { PythonChatResponse, CompletedToolCallPayload, CompletedToolCallFromPython } from '@/lib/chat-orchestration';

export interface EvalRunRequest {
  eval_item?: EvalItem;
  test?: Test;                // new: accepts a unified Test directly
  schema: DatabaseWithSchema[];
  documentation: string;
  connection_id: string;
}

export interface EvalRunResponse {
  passed: boolean;
  details: Record<string, unknown>;
  error?: string;
  log?: CompletedToolCallFromPython[];  // Full agent trace for display
}


/**
 * POST /api/jobs/test
 * Run a single eval item OR a unified Test against the agent and return pass/fail.
 *
 * Accepts two body formats:
 *   - { eval_item, schema, documentation, connection_id } — legacy EvalItem format
 *   - { test, connection_id }                             — new unified Test format
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user || !user.companyId) {
      return NextResponse.json({ passed: false, error: 'Unauthorized' } as EvalRunResponse, { status: 401 });
    }

    const body: EvalRunRequest = await request.json();
    const { eval_item, test, schema, documentation, connection_id } = body;

    // New path: unified Test type — delegate to server runner
    if (test) {
      const runner = createServerRunner(user, connection_id || '');
      const result = await runner.execute(test);
      // Return as TestRunResult directly (client runner expects this shape)
      return NextResponse.json(result);
    }

    if (!eval_item) {
      return NextResponse.json({ passed: false, error: 'eval_item or test is required' } as EvalRunResponse, { status: 400 });
    }

    // Build app_state from eval_item.app_state
    let app_state: Record<string, unknown> | null = null;
    if (eval_item.app_state.type === 'file') {
      const file = await DocumentDB.getById(eval_item.app_state.file_id, user.companyId);
      if (file) {
        app_state = {
          type: 'file',
          file: { id: file.id, name: file.name, path: file.path, type: file.type, content: file.content }
        };
      }
    }

    // Build the Python chat request
    const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
    const agentArgs = {
      goal: eval_item.question,
      assertion: eval_item.assertion,
      schema,
      context: documentation,
      connection_id: eval_item.connection_id || connection_id,
      app_state,
      home_folder: resolvedHomeFolder,
    };

    // Run agent + orchestration loop (no conversation storage).
    // log is accumulated across iterations — same protocol as regular chat (logDiff → next log).
    // Without this, Python's resume() has no task history to replay against and restarts fresh.
    let log: ConversationLogEntry[] = [];
    const allCompletedFromPython: CompletedToolCallFromPython[] = [];
    let completedToolCalls: CompletedToolCallPayload[] = [];
    let userMessage: string | null = eval_item.question;

    // Dummy file/log IDs — evals don't persist conversations
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

      const response = await pythonBackendFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errText = await response.text();
        return NextResponse.json({ passed: false, error: `Agent error: ${errText}` } as EvalRunResponse, { status: 500 });
      }

      const pythonResponse: PythonChatResponse = await response.json();
      allCompletedFromPython.push(...pythonResponse.completed_tool_calls);
      log = [...log, ...pythonResponse.logDiff];  // Accumulate log so Python can resume
      userMessage = null;

      if (pythonResponse.pending_tool_calls.length === 0) {
        break;
      }

      // Orchestrate pending tools (no conversation append for evals)
      const orchResult = await orchestratePendingTools(
        pythonResponse.pending_tool_calls,
        DUMMY_FILE_ID,
        DUMMY_LOG_INDEX,
        user
      );

      completedToolCalls = orchResult.completedTools;

      // If only frontend tools remain (no backend completed), break to avoid infinite loop
      if (orchResult.completedTools.length === 0 && orchResult.remainingPendingTools.length > 0) {
        break;
      }
      if (orchResult.completedTools.length === 0 && orchResult.remainingPendingTools.length === 0) {
        break;
      }
    }

    // Find the submit tool call in completed results.
    // SubmitBinary/SubmitNumber execute in Python (no UserInputException), so they appear in
    // allCompletedFromPython with their function.name and the answer as the return value.
    const submitCall = allCompletedFromPython.find(
      tc => tc.function?.name === 'SubmitBinary' ||
            tc.function?.name === 'SubmitNumber' ||
            tc.function?.name === 'CannotAnswer'
    );

    if (!submitCall) {
      return NextResponse.json({
        passed: false,
        details: { error: 'Agent did not call SubmitBinary, SubmitNumber, or CannotAnswer' },
        log: allCompletedFromPython,
      } as EvalRunResponse);
    }

    // Parse submit content
    let submitContent: Record<string, unknown> = {};
    try {
      submitContent = typeof submitCall.content === 'string'
        ? JSON.parse(submitCall.content)
        : (submitCall.content as Record<string, unknown>) || {};
    } catch {
      submitContent = {};
    }

    // cannot_answer expected value: passes iff agent called CannotAnswer, fails if it submitted a value
    if (eval_item.assertion.cannot_answer) {
      const agentCalledCannotAnswer = submitCall.function?.name === 'CannotAnswer';
      const reason = agentCalledCannotAnswer
        ? ((submitContent.reason as string) ?? 'No reason given')
        : undefined;
      return NextResponse.json({
        passed: agentCalledCannotAnswer,
        details: agentCalledCannotAnswer
          ? { cannot_answer: true, reason }
          : { cannot_answer: false, submitted_tool: submitCall.function?.name },
        log: allCompletedFromPython,
      } as EvalRunResponse);
    }

    // CannotAnswer: agent signalled it cannot determine an answer (unexpected for binary/number evals)
    if (submitCall.function?.name === 'CannotAnswer') {
      const reason = (submitContent.reason as string) ?? 'No reason given';
      return NextResponse.json({
        passed: false,
        details: { cannot_answer: true, reason },
        log: allCompletedFromPython,
      } as EvalRunResponse);
    }

    // Run assertion comparison
    if (eval_item.assertion.type === 'binary') {
      const assertion = eval_item.assertion as BinaryAssertion;
      const submittedAnswer = submitContent.answer as boolean;
      const passed = submittedAnswer === assertion.answer;
      return NextResponse.json({
        passed,
        details: { submitted: submittedAnswer, expected: assertion.answer },
        log: allCompletedFromPython,
      } as EvalRunResponse);
    }

    // number_match assertion
    const assertion = eval_item.assertion as NumberAssertion;
    const submitted = parseFloat(String(submitContent.answer));

    // Resolve expected value: from question_id (run its query, take first cell) or static answer
    let expected = assertion.answer;
    if (assertion.question_id) {
      const qFile = await DocumentDB.getById(assertion.question_id, user.companyId);
      if (!qFile) {
        return NextResponse.json({
          passed: false,
          details: { error: `Question file ${assertion.question_id} not found` },
          log: allCompletedFromPython,
        } as EvalRunResponse);
      }
      const qContent = qFile.content as QuestionContent;
      const qResult = await runQuery(qContent.database_name, qContent.query, {}, user);
      if (!qResult.rows.length || !qResult.columns.length) {
        return NextResponse.json({
          passed: false,
          details: { error: 'Expected-value question returned no rows' },
          log: allCompletedFromPython,
        } as EvalRunResponse);
      }
      const col = assertion.column && qResult.columns.includes(assertion.column)
        ? assertion.column
        : qResult.columns[0];
      expected = parseFloat(String(qResult.rows[0][col]));
    }

    const passed = Math.abs(submitted - expected) < 0.0001;
    return NextResponse.json({
      passed,
      details: { submitted, expected },
      log: allCompletedFromPython,
    } as EvalRunResponse);

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ passed: false, error: msg } as EvalRunResponse, { status: 500 });
  }
}
