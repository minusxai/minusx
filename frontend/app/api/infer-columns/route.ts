/**
 * API route for inferring output columns from a question's SQL
 * Accepts a questionId, loads the question and its connection schema,
 * then infers output columns locally via -sql/sdk (WASM).
 */

import { withAuth } from '@/lib/http/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/http/api-responses';
import { FilesAPI } from '@/lib/data/files.server';
import { QuestionContent, DatabaseWithSchema, connectionTypeToDialect } from '@/lib/types';
import { FileNotFoundError } from '@/lib/errors';
import { inferColumnsLocal } from '@/lib/sql/infer-columns';
import { runSpreadsheetSource } from '@/lib/spreadsheet/materialize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body: { questionId?: number; sql?: string; connectionName?: string } = await request.json();
    const { questionId, sql, connectionName } = body;

    // Two source kinds (the QueryValueSelector contract): a saved question, or
    // inline SQL + connection. Both resolve to (query, connection_name) below.
    let query: string;
    let queryConnectionName: string | undefined;

    if (typeof questionId === 'number' && questionId > 0) {
      // Load the question file
      let questionResult;
      try {
        questionResult = await FilesAPI.loadFile(questionId, user);
      } catch (err) {
        if (err instanceof FileNotFoundError) {
          return NextResponse.json(
            { columns: [], error: 'Question not found' },
            { status: 404 }
          );
        }
        throw err;
      }

      if (!questionResult.data || questionResult.data.type !== 'question') {
        return NextResponse.json(
          { columns: [], error: 'Question not found' },
          { status: 404 }
        );
      }
      const questionContent = questionResult.data.content as QuestionContent;
      if (questionContent.spreadsheet) {
        const materialized = runSpreadsheetSource(questionContent.spreadsheet);
        if (!materialized.ok) {
          return NextResponse.json({ columns: [], errors: materialized.errors }, { status: 400 });
        }
        return NextResponse.json({
          columns: materialized.data.columns.map((name, index) => ({ name, type: materialized.data.types[index] })),
        });
      }
      query = questionContent.query;
      queryConnectionName = questionContent.connection_name;
    } else if (typeof sql === 'string' && sql.trim() && typeof connectionName === 'string') {
      query = sql;
      queryConnectionName = connectionName;
    } else {
      return NextResponse.json(
        { columns: [], error: 'questionId or { sql, connectionName } is required' },
        { status: 400 }
      );
    }

    if (!query.trim()) {
      return NextResponse.json({ columns: [] });
    }

    // Try to load schema and dialect from the source's connection
    let schemaData: DatabaseWithSchema[] = [];
    let dialect = 'duckdb';
    if (queryConnectionName) {
      try {
        const connectionsResult = await FilesAPI.getFiles({ type: 'connection' }, user);
        const connection = connectionsResult.data.find(
          (f: any) => f.name === queryConnectionName
        );
        if (connection) {
          const fullConnection = await FilesAPI.loadFile(connection.id, user);
          const connContent = fullConnection.data?.content as any;
          if (connContent?.type) {
            dialect = connectionTypeToDialect(connContent.type);
          }
          if (connContent?.schema?.schemas) {
            schemaData = [{
              databaseName: connection.name,
              schemas: connContent.schema.schemas,
            }];
          }
        }
      } catch (err) {
        // Schema loading is best-effort; proceed without it
        console.warn('[infer-columns] Failed to load connection schema:', err);
      }
    }

    // Infer columns locally via WASM.
    const data = await inferColumnsLocal(query, schemaData, dialect);
    return NextResponse.json(data);

  } catch (error) {
    console.error('[API /infer-columns] Error:', error);
    return handleApiError(error);
  }
});
