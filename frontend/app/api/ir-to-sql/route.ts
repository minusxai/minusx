/**
 * API route for IR to SQL conversion
 * Proxies to Python backend /api/ir-to-sql endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { handleApiError } from '@/lib/api/api-responses';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ir, dialect } = body;

    // Forward to Python backend
    const response = await pythonBackendFetch('/api/ir-to-sql', {
      method: 'POST',
      body: JSON.stringify({ ir, dialect }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[API /ir-to-sql] Error:', error);
    return handleApiError(error);
  }
}
