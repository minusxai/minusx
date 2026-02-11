/**
 * API route for SQL to IR conversion
 * Proxies to Python backend /api/sql-to-ir endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sql, databaseName } = body;

    // Forward to Python backend
    const response = await pythonBackendFetch('/api/sql-to-ir', {
      method: 'POST',
      body: JSON.stringify({
        sql,
        database_name: databaseName,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[API /sql-to-ir] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        unsupportedFeatures: ['PARSE_ERROR'],
      },
      { status: 500 }
    );
  }
}
