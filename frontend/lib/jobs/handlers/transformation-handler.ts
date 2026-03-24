import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { DocumentDB } from '@/lib/database/documents-db';
import { resolvePath } from '@/lib/mode/path-resolver';
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
  async execute({ file }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const transformation = file as TransformationContent;
    const results: TransformResult[] = [];

    for (const transform of transformation.transforms ?? []) {
      const { question: questionId, output: { schema_name: schema, view } } = transform;
      let questionName = `Question #${questionId}`;
      let sql = '';

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
        sql = `CREATE OR REPLACE VIEW "${schema}"."${view}" AS\n${question.query}`;

        // Execute DDL via Python backend (Postgres/BigQuery support DDL natively)
        await runQuery(question.database_name, sql, {}, user);

        results.push({ questionId, questionName, schema, view, sql, status: 'success' });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        results.push({ questionId, questionName, schema, view, sql, status: 'error', error });
      }
    }

    const output: TransformationOutput = { results };
    return { output, messages: [] };
  },
};
