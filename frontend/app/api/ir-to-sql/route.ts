/**
 * API route for IR to SQL conversion
 * Proxies to Python backend /api/ir-to-sql endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ir } = body;

    // Forward to Python backend
    const response = await pythonBackendFetch('/api/ir-to-sql', {
      method: 'POST',
      body: JSON.stringify({ ir }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[API /ir-to-sql] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
