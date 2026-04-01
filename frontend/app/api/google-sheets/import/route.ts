import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { handleApiError } from '@/lib/api/api-responses';

export const POST = withAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const response = await pythonBackendFetch('/api/google-sheets/import', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.ok ? 200 : 400 });
  } catch (error) {
    return handleApiError(error);
  }
});
