import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { evaluateCondition, extractMetricValue } from '@/lib/alert/evaluate-alert';
import { AUTH_URL } from '@/lib/config';
import { CompanyDB } from '@/lib/database/company-db';
import { isSubdomainRoutingEnabled } from '@/lib/utils/subdomain';
import type { AlertContent, AlertOutput, JobHandlerResult, JobRunnerInput, QuestionContent } from '@/lib/types';
import type { JobHandler } from '../job-registry';

async function resolveBaseUrl(companyId: number): Promise<string> {
  if (!isSubdomainRoutingEnabled()) return AUTH_URL;
  const company = await CompanyDB.getById(companyId);
  if (!company?.subdomain) return AUTH_URL;
  const url = new URL(AUTH_URL);
  return `${url.protocol}//${company.subdomain}.${url.host}`;
}

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
      const bodySingleLine = body.replace(/\n/g, ' ');
      const subject = `[Alert Triggered] ${alertName}`;
      const baseUrl = await resolveBaseUrl(user.companyId);
      const alertLink = `${baseUrl}/f/${runFileId}`;
      for (const recipient of alert.recipients) {
        if (recipient.channel === 'email_alert') {
          messages.push({ type: 'email_alert', content: body, metadata: { to: recipient.address, subject } });
        } else if (recipient.channel === 'phone_alert') {
          messages.push({
            type: 'phone_alert',
            content: bodySingleLine,
            metadata: {
              to:      recipient.address,
              title:   alertName,
              desc:    alert.description ?? bodySingleLine,
              link:    alertLink,
              summary: bodySingleLine,
            },
          });
        }
      }
    }

    return { output, messages };
  },
};
