import { withAuth } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';
// import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { FilesAPI } from '@/lib/data/files.server';
import { connectionTypeToDialect } from '@/lib/types';
import { validateSqlLocal } from '@/lib/sql/validate-sql';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  const body = await request.json();
  const { query, databaseName } = body;

  // Resolve dialect from connection type
  let dialect = 'duckdb';
  if (databaseName) {
    try {
      const connectionsResult = await FilesAPI.getFiles({ type: 'connection' }, user);
      const connection = connectionsResult.data.find((f: any) => f.name === databaseName);
      if (connection) {
        const fullConnection = await FilesAPI.loadFile(connection.id, user);
        const connectionContent = fullConnection.data.content as any;
        if (connectionContent?.type) {
          dialect = connectionTypeToDialect(connectionContent.type);
        }
      }
    } catch (error) {
      console.warn('[validate-sql] Failed to resolve connection type:', error);
    }
  }

  // Validate locally via WASM (replaces Python backend call)
  const data = await validateSqlLocal(query, dialect);
  return NextResponse.json(data);

  // --- Previous implementation: forward to Python backend ---
  // const response = await pythonBackendFetch('/api/validate-sql', {
  //   method: 'POST',
  //   body: JSON.stringify({ query, dialect }),
  // });
  // const data = await response.json();
  // return NextResponse.json(data, { status: response.status });
});
