/**
 * API route for inferring output columns from a question's SQL
 * Accepts a questionId, loads the question and its connection schema,
 * then calls Python /api/infer-columns via sqlglot for static analysis.
 */

import { withAuth } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/api-responses';
import { FilesAPI } from '@/lib/data/files.server';
import { QuestionContent, DatabaseWithSchema, connectionTypeToDialect } from '@/lib/types';
import { FileNotFoundError } from '@/lib/errors';
import { inferColumnsLocal } from '@/lib/sql/infer-columns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body: { questionId: number } = await request.json();
    const { questionId } = body;

    if (!questionId || typeof questionId !== 'number') {
      return NextResponse.json(
        { columns: [], error: 'questionId is required' },
        { status: 400 }
      );
    }

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
    const query = questionContent.query || '';

    if (!query.trim()) {
      return NextResponse.json({ columns: [] });
    }

    // Try to load schema and dialect from the question's connection
    let schemaData: DatabaseWithSchema[] = [];
    let dialect = 'duckdb';
    if (questionContent.connection_name) {
      try {
        const connectionsResult = await FilesAPI.getFiles({ type: 'connection' }, user);
        const connection = connectionsResult.data.find(
          (f: any) => f.name === questionContent.connection_name
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

    // Infer columns locally via WASM (replaces Python backend call)
    const data = await inferColumnsLocal(query, schemaData, dialect);
    return NextResponse.json(data);

  } catch (error) {
    console.error('[API /infer-columns] Error:', error);
    return handleApiError(error);
  }
});
