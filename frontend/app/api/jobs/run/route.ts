/**
 * POST /api/jobs/run
 * Trigger a job execution (manual or forced).
 * Currently supports job_type: 'alert'
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { resolvePath } from '@/lib/mode/path-resolver';
import { getNodeConnector } from '@/lib/connections';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { evaluateCondition, extractMetricValue } from '@/lib/alert/evaluate-alert';
import type { AlertContent, AlertRunContent, QuestionContent, ConnectionContent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { job_id, job_type } = body as { job_id: string; job_type: string };

    if (!job_id || !job_type) {
      return ApiErrors.badRequest('job_id and job_type are required');
    }

    if (job_type !== 'alert') {
      return ApiErrors.badRequest(`Unsupported job_type: ${job_type}`);
    }

    // Ensure job_runs table exists (handles existing DBs without migration)
    await JobRunsDB.ensureTable();

    const alertId = parseInt(job_id, 10);
    if (isNaN(alertId)) {
      return ApiErrors.badRequest('job_id must be a numeric file ID for alert jobs');
    }

    // 1. Load the alert file
    const alertResult = await FilesAPI.loadFile(alertId, user);
    const alertFile = alertResult.data;
    if (!alertFile?.content) {
      return ApiErrors.notFound('Alert');
    }
    const alert = alertFile.content as AlertContent;
    const alertName = alertFile.name;

    if (!alert.questionId || alert.questionId <= 0) {
      return ApiErrors.badRequest('Alert has no referenced question');
    }

    // 2. Create job_run record immediately (status=RUNNING)
    const runInput = {
      alertId,
      alertName,
      questionId: alert.questionId,
      condition: alert.condition,
    };
    const runId = await JobRunsDB.create({
      job_id,
      job_type: 'alert',
      company_id: user.companyId,
      input: runInput,
      source: 'manual',
    });

    const startedAt = new Date().toISOString();

    try {
      // 3. Load referenced question
      const questionResult = await FilesAPI.loadFile(alert.questionId, user);
      const questionFile = questionResult.data;
      if (!questionFile?.content) {
        throw new Error('Referenced question not found');
      }
      const question = questionFile.content as QuestionContent;

      // 4. Execute query (mirrors /api/query logic)
      const paramValues: Record<string, string | number> = {};
      if (question.parameterValues && typeof question.parameterValues === 'object') {
        Object.assign(paramValues, question.parameterValues);
      }

      let queryResult: { columns: string[]; types: string[]; rows: Record<string, any>[] };

      const connPath = resolvePath(user.mode, `/database/${question.database_name}`);
      const connFile = await DocumentDB.getByPath(connPath, user.companyId);
      if (connFile?.content) {
        const { type, config } = connFile.content as ConnectionContent;
        const connector = getNodeConnector(question.database_name, type, config);
        if (connector) {
          queryResult = await connector.query(question.query, paramValues);
        } else {
          const response = await pythonBackendFetch('/api/execute-query', {
            method: 'POST',
            body: JSON.stringify({ query: question.query, parameters: paramValues, database_name: question.database_name }),
          });
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || data.message || 'Query execution failed');
          }
          queryResult = await response.json();
        }
      } else {
        throw new Error(`Connection not found: ${question.database_name}`);
      }

      // 5. Evaluate condition
      const actualValue = extractMetricValue(queryResult.rows, alert.condition);
      const triggered = evaluateCondition(actualValue, alert.condition.operator, alert.condition.threshold);

      // 6. Create alert_run file
      const completedAt = new Date().toISOString();
      const runContent: AlertRunContent = {
        alertId,
        alertName,
        startedAt,
        completedAt,
        status: triggered ? 'triggered' : 'not_triggered',
        actualValue,
        threshold: alert.condition.threshold,
        operator: alert.condition.operator,
        selector: alert.condition.selector,
        function: alert.condition.function,
        column: alert.condition.column,
      };

      const timestamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
      const runPath = resolvePath(user.mode, `/logs/alerts/${alertId}/${timestamp}`);

      const createResult = await FilesAPI.createFile(
        {
          name: timestamp,
          path: runPath,
          type: 'alert_run',
          content: runContent,
          references: [alertId],
          options: { createPath: true },
        },
        user
      );
      const resultFileId = createResult.data.id;

      // 7. Update job_run to SUCCESS
      const jobOutput = { actualValue, triggered };
      await JobRunsDB.complete(runId, 'SUCCESS', resultFileId, jobOutput);

      return successResponse({ runId, fileId: resultFileId, status: 'SUCCESS', output: jobOutput });
    } catch (execError) {
      const errorMessage = execError instanceof Error ? execError.message : 'Unknown error';

      // Save failed alert_run file
      let failedFileId: number | undefined;
      try {
        const runContent: AlertRunContent = {
          alertId,
          alertName,
          startedAt,
          completedAt: new Date().toISOString(),
          status: 'failed',
          actualValue: null,
          threshold: alert.condition.threshold,
          operator: alert.condition.operator,
          selector: alert.condition.selector,
          function: alert.condition.function,
          column: alert.condition.column,
          error: errorMessage,
        };
        const timestamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
        const runPath = resolvePath(user.mode, `/logs/alerts/${alertId}/${timestamp}`);
        const createResult = await FilesAPI.createFile(
          { name: timestamp, path: runPath, type: 'alert_run', content: runContent, references: [alertId], options: { createPath: true } },
          user
        );
        failedFileId = createResult.data.id;
      } catch {
        // Ignore save failure
      }

      await JobRunsDB.complete(runId, 'FAILURE', failedFileId, undefined, errorMessage);
      return successResponse({ runId, fileId: failedFileId ?? null, status: 'FAILURE', error: errorMessage });
    }
  } catch (error) {
    return handleApiError(error);
  }
});
