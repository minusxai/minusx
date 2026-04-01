import 'server-only';
import { resolveBaseUrl } from '@/lib/jobs/job-utils';
import { BACKEND_URL } from '@/lib/config';
import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { DocumentDB } from '@/lib/database/documents-db';
import { resolvePath } from '@/lib/mode/path-resolver';
import { createServerRunner } from '@/lib/tests/server';
import type { JobHandler } from '../job-registry';
import type {
  ConnectionContent,
  JobHandlerResult,
  JobRunnerInput,
  QuestionContent,
  TransformResult,
  TransformationContent,
  TransformationOutput,
} from '@/lib/types';

export const transformationJobHandler: JobHandler = {
  async execute({ file, runMode = 'full', jobId, runFileId }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const transformation = file as TransformationContent;
    const results: TransformResult[] = [];
    const testRunner = createServerRunner(user, '');

    for (const transform of transformation.transforms ?? []) {
      const { question: questionId, output: { schema_name: schema, view }, tests = [] } = transform;
      let questionName = `Question #${questionId}`;
      let sql = '';

      if (runMode === 'test_only') {
        // Skip transform execution — run tests only
        const testResults = await Promise.all(tests.map(t => testRunner.execute(t)));
        results.push({ questionId, questionName, schema, view, sql, status: 'skipped', testResults });
        continue;
      }

      try {
        // Load the referenced question
        const questionResult = await FilesAPI.loadFile(questionId, user);
        const question = questionResult.data?.content as QuestionContent | undefined;
        questionName = questionResult.data?.name ?? questionName;

        if (!question) {
          results.push({ questionId, questionName, schema, view, sql, status: 'error', error: `Question #${questionId} not found` });
          continue;
        }

        if (!question.database_name) {
          results.push({ questionId, questionName, schema, view, sql, status: 'error', error: 'Question has no database connection configured' });
          continue;
        }

        // Check connection type — DuckDB is read-only, cannot create views
        const connPath = resolvePath(user.mode, `/database/${question.database_name}`);
        const connFile = await DocumentDB.getByPath(connPath, user.companyId);
        if (connFile?.content) {
          const connectionType = (connFile.content as ConnectionContent).type;
          if (connectionType === 'duckdb') {
            results.push({ questionId, questionName, schema, view, sql, status: 'error', error: 'DuckDB connections do not support transformations (read-only).' });
            continue;
          }
        }

        // Build DDL using CREATE OR REPLACE VIEW for idempotent execution
        const connectionType = connFile?.content ? (connFile.content as ConnectionContent).type : null;
        if (connectionType === 'bigquery') {
          sql = `CREATE OR REPLACE VIEW \`${schema}\`.\`${view}\` AS\n${question.query}`;
        } else {
          sql = `CREATE OR REPLACE VIEW "${schema}"."${view}" AS\n${question.query}`;
        }

        // Execute DDL via Python backend
        try {
          await runQuery(question.database_name, sql, {}, user);
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          const error = raw === 'fetch failed'
            ? `Could not reach Python backend (fetch failed). Is the backend running at ${BACKEND_URL}?`
            : raw;
          results.push({ questionId, questionName, schema, view, sql, status: 'error', error });
          continue;
        }

        // Run tests attached to this transform step
        const testResults = tests.length > 0
          ? await Promise.all(tests.map(t => testRunner.execute(t)))
          : undefined;

        results.push({ questionId, questionName, schema, view, sql, status: 'success', testResults });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        results.push({ questionId, questionName, schema, view, sql, status: 'error', error });
      }
    }

    const hasErrors = results.some(r => r.status === 'error');
    const hasFailedTests = results.some(r => r.testResults?.some(tr => !tr.passed));
    const output: TransformationOutput = { results, runMode };
    const overallStatus = hasErrors || hasFailedTests ? 'failure' : 'success';

    const messages: JobHandlerResult['messages'] = [];
    if (transformation.recipients && transformation.recipients.length > 0) {
      const transformationFileResult = await FilesAPI.loadFile(parseInt(jobId, 10), user);
      const transformationName = transformationFileResult.data?.name ?? `Transformation ${jobId}`;
      const baseUrl = await resolveBaseUrl(user.companyId);
      const link = `${baseUrl}/f/${runFileId}`;
      const subject = `[Transformation] ${transformationName}`;
      const succeeded = results.filter(r => r.status === 'success').length;
      const body = `<h2>${transformationName}</h2><p>${succeeded}/${results.length} transforms succeeded.</p><p><a href="${link}">View results</a></p>`;

      for (const recipient of transformation.recipients) {
        if (recipient.channel === 'email_alert') {
          messages.push({ type: 'email_alert', content: body, metadata: { to: recipient.address, subject } });
        }
      }
    }

    return { output, messages, status: overallStatus };
  },
};
