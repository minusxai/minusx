import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { evaluateCondition, extractMetricValue } from '@/lib/alert/evaluate-alert';
import type { AlertContent, AlertRunContent, QuestionContent } from '@/lib/types';
import type { JobHandler, JobResult } from '../job-registry';

export const alertJobHandler: JobHandler = {
  async execute(jobId, alertContent, user, _runId): Promise<JobResult> {
    const alert = alertContent as AlertContent;
    const alertId = parseInt(jobId, 10);
    const startedAt = new Date().toISOString();

    const alertResult = await FilesAPI.loadFile(alertId, user);
    const alertName = alertResult.data?.name ?? `Alert ${alertId}`;

    const failureContent = (error: string): AlertRunContent => ({
      alertId,
      alertName,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'failed',
      actualValue: null,
      threshold: alert.condition?.threshold ?? 0,
      operator: alert.condition?.operator ?? '>',
      selector: alert.condition?.selector ?? 'first',
      function: alert.condition?.function ?? 'value',
      column: alert.condition?.column,
      error,
    });

    if (!alert.questionId || alert.questionId <= 0) {
      return { status: 'FAILURE', content: failureContent('Alert has no referenced question'), file_type: 'alert_run' };
    }

    try {
      const questionResult = await FilesAPI.loadFile(alert.questionId, user);
      const question = questionResult.data?.content as QuestionContent | undefined;
      if (!question) throw new Error('Referenced question not found');

      const params: Record<string, string | number> = {};
      if (question.parameterValues && typeof question.parameterValues === 'object') {
        Object.assign(params, question.parameterValues);
      }

      const queryResult = await runQuery(question.database_name, question.query, params, user);

      const actualValue = extractMetricValue(queryResult.rows, alert.condition);
      const triggered = evaluateCondition(actualValue, alert.condition.operator, alert.condition.threshold);

      const content: AlertRunContent = {
        alertId,
        alertName,
        startedAt,
        completedAt: new Date().toISOString(),
        status: triggered ? 'triggered' : 'not_triggered',
        actualValue,
        threshold: alert.condition.threshold,
        operator: alert.condition.operator,
        selector: alert.condition.selector,
        function: alert.condition.function,
        column: alert.condition.column,
      };

      return { status: 'SUCCESS', content, file_type: 'alert_run' };
    } catch (err) {
      return { status: 'FAILURE', content: failureContent(err instanceof Error ? err.message : 'Unknown error'), file_type: 'alert_run' };
    }
  },
};
