import { withAuth } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { FilesAPI } from '@/lib/data/files.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  const body = await request.json();
  const { query, databaseName } = body;

  // Resolve connection type from databaseName
  let dbType = 'postgres';
  if (databaseName) {
    try {
      const connectionsResult = await FilesAPI.getFiles({ type: 'connection' }, user);
      const connection = connectionsResult.data.find((f: any) => f.name === databaseName);
      if (connection) {
        const fullConnection = await FilesAPI.loadFile(connection.id, user);
        const connectionContent = fullConnection.data.content as any;
        if (connectionContent?.type) {
          dbType = connectionContent.type;
        }
      }
    } catch (error) {
      console.warn('[validate-sql] Failed to resolve connection type:', error);
    }
  }

  // Forward to Python backend
  const response = await pythonBackendFetch('/api/validate-sql', {
    method: 'POST',
    body: JSON.stringify({ query, db_type: dbType }),
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
});
