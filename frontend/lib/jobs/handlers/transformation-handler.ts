import 'server-only';
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
  async execute({ file, runMode = 'full' }: JobRunnerInput, user): Promise<JobHandlerResult> {
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
            ? `Could not reach Python backend (fetch failed). Is the backend running at ${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8001'}?`
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
    return { output, messages: [], status: overallStatus };
  },
};
