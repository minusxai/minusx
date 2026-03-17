import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { evaluateCondition, extractMetricValue } from '@/lib/alert/evaluate-alert';
import { AUTH_URL } from '@/lib/config';
import type { AlertContent, AlertOutput, JobHandlerResult, JobRunnerInput, QuestionContent } from '@/lib/types';
import type { JobHandler } from '../job-registry';

export const alertJobHandler: JobHandler = {
  async execute({ runFileId, jobId, file, previousRuns: _previousRuns }, user): Promise<JobHandlerResult> {
    const alert = file as AlertContent;
    const alertId = parseInt(jobId, 10);

    const alertResult = await FilesAPI.loadFile(alertId, user);
    const alertName = alertResult.data?.name ?? `Alert ${alertId}`;

    if (!alert.questionId || alert.questionId <= 0) {
      throw new Error('Alert has no referenced question');
    }

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

    const output: AlertOutput = {
      alertId,
      alertName,
      status: triggered ? 'triggered' : 'not_triggered',
      actualValue,
      threshold: alert.condition.threshold,
      operator: alert.condition.operator,
      selector: alert.condition.selector,
      function: alert.condition.function,
      column: alert.condition.column,
    };

    const messages: JobHandlerResult['messages'] = [];
    if (triggered && alert.recipients && alert.recipients.length > 0) {
      const body = `Alert "${alertName}" triggered.\nValue: ${actualValue} ${alert.condition.operator} ${alert.condition.threshold}`;
      const subject = `[Alert Triggered] ${alertName}`;
      const alertLink = `${AUTH_URL}/f/${runFileId}`;
      for (const recipient of alert.recipients) {
        if (recipient.channel === 'email_alert') {
          messages.push({ type: 'email_alert', content: body, metadata: { to: recipient.address, subject } });
        } else if (recipient.channel === 'phone_alert') {
          messages.push({
            type: 'phone_alert',
            content: body,
            metadata: {
              to:      recipient.address,
              title:   alertName,
              desc:    alert.description ?? '',
              link:    alertLink,
              summary: body,
            },
          });
        }
      }
    }

    return { output, messages };
  },
};
