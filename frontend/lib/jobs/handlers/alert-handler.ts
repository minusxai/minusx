import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { resolvePath } from '@/lib/mode/path-resolver';
import { getNodeConnector } from '@/lib/connections';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { evaluateCondition, extractMetricValue } from '@/lib/alert/evaluate-alert';
import type { AlertContent, AlertRunContent, QuestionContent, ConnectionContent } from '@/lib/types';
import type { JobHandler, JobResult } from '../job-registry';

export const alertJobHandler: JobHandler = {
  async execute(jobId, alertContent, user, runId): Promise<JobResult> {
    const alert = alertContent as AlertContent;
    const alertId = parseInt(jobId, 10);
    const startedAt = new Date().toISOString();

    // Load the alert file to get its name
    const alertResult = await FilesAPI.loadFile(alertId, user);
    const alertName = alertResult.data?.name ?? `Alert ${alertId}`;

    if (!alert.questionId || alert.questionId <= 0) {
      const content: AlertRunContent = {
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
        error: 'Alert has no referenced question',
      };
      return { status: 'FAILURE', content, file_type: 'alert_run' };
    }

    try {
      // Load referenced question
      const questionResult = await FilesAPI.loadFile(alert.questionId, user);
      const questionFile = questionResult.data;
      if (!questionFile?.content) {
        throw new Error('Referenced question not found');
      }
      const question = questionFile.content as QuestionContent;

      // Execute query
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

      // Evaluate condition
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
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const content: AlertRunContent = {
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
        error: errorMessage,
      };
      return { status: 'FAILURE', content, file_type: 'alert_run' };
    }
  },
};
