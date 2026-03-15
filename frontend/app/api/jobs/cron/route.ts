/**
 * POST /api/jobs/cron
 * Called by an external cron on a per-minute schedule.
 * Scans all 'live' alerts and triggers those whose cron expression fires in the current minute.
 *
 * External trigger options:
 *   - Vercel Cron Jobs (vercel.json)
 *   - Railway cron
 *   - Any scheduler that can POST to this endpoint
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
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

// ---------------------------------------------------------------------------
// Minimal cron expression evaluator (handles *, numbers, ranges, lists, steps)
// Format: "minute hour day-of-month month day-of-week"
// ---------------------------------------------------------------------------
function matchesCronField(expr: string, value: number): boolean {
  if (expr === '*') return true;

  // Handle list: "1,2,5"
  if (expr.includes(',')) {
    return expr.split(',').some((part) => matchesCronField(part.trim(), value));
  }

  // Handle step: "*/5" or "0-59/5"
  if (expr.includes('/')) {
    const [rangeExpr, stepStr] = expr.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;
    if (rangeExpr === '*') return value % step === 0;
    // range/step
    if (rangeExpr.includes('-')) {
      const [start, end] = rangeExpr.split('-').map(Number);
      if (value < start || value > end) return false;
      return (value - start) % step === 0;
    }
    return false;
  }

  // Handle range: "1-5"
  if (expr.includes('-')) {
    const [start, end] = expr.split('-').map(Number);
    return value >= start && value <= end;
  }

  // Literal number
  return parseInt(expr, 10) === value;
}

function isCronDue(cronExpr: string, date: Date): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return (
    matchesCronField(min, date.getMinutes()) &&
    matchesCronField(hour, date.getHours()) &&
    matchesCronField(dom, date.getDate()) &&
    matchesCronField(month, date.getMonth() + 1) &&
    matchesCronField(dow, date.getDay())
  );
}

// ---------------------------------------------------------------------------

export const POST = withAuth(async (_request: NextRequest, user) => {
  try {
    await JobRunsDB.ensureTable();

    const now = new Date();
    // Dedup window: current minute ±30s
    const windowStart = new Date(now.getTime() - 30_000);
    const windowEnd = new Date(now.getTime() + 30_000);

    // Load all alert files for this company (with content to check status)
    const allAlertFiles = await DocumentDB.listAll(user.companyId, 'alert', undefined, -1, true);

    let triggered = 0;
    let skipped = 0;
    let failed = 0;

    for (const alertFile of allAlertFiles) {
      const alert = alertFile.content as AlertContent | null;
      if (!alert || alert.status !== 'live') { skipped++; continue; }
      if (!alert.schedule?.cron || !isCronDue(alert.schedule.cron, now)) { skipped++; continue; }
      if (!alert.questionId || alert.questionId <= 0) { skipped++; continue; }

      const alertId = alertFile.id;
      const alertName = alertFile.name;
      const runInput = { alertId, alertName, questionId: alert.questionId, condition: alert.condition };

      const { runId, isNewRun } = await JobRunsDB.findOrCreate({
        job_id: String(alertId),
        job_type: 'alert',
        company_id: user.companyId,
        window_start: windowStart,
        window_end: windowEnd,
        input: runInput,
        source: 'cron',
      });

      if (!isNewRun) { skipped++; continue; }

      const startedAt = new Date().toISOString();
      try {
        // Load question
        const questionResult = await FilesAPI.loadFile(alert.questionId, user);
        const question = questionResult.data.content as QuestionContent;

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
              throw new Error(data.detail || 'Query execution failed');
            }
            queryResult = await response.json();
          }
        } else {
          throw new Error(`Connection not found: ${question.database_name}`);
        }

        const actualValue = extractMetricValue(queryResult.rows, alert.condition);
        const isTriggered = evaluateCondition(actualValue, alert.condition.operator, alert.condition.threshold);

        const completedAt = new Date().toISOString();
        const runContent: AlertRunContent = {
          alertId,
          alertName,
          startedAt,
          completedAt,
          status: isTriggered ? 'triggered' : 'not_triggered',
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
          { name: timestamp, path: runPath, type: 'alert_run', content: runContent, references: [alertId], options: { createPath: true } },
          user
        );

        await JobRunsDB.complete(runId, 'SUCCESS', createResult.data.id, { actualValue, triggered: isTriggered });
        triggered++;
      } catch (execError) {
        const errorMessage = execError instanceof Error ? execError.message : 'Unknown error';
        await JobRunsDB.complete(runId, 'FAILURE', undefined, undefined, errorMessage);
        failed++;
      }
    }

    return successResponse({ triggered, skipped, failed });
  } catch (error) {
    return handleApiError(error);
  }
});
