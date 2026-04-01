import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { BACKEND_URL } from '@/lib/config';

export const DELETE = withAuth(async (request: NextRequest, user, context) => {
  try {
    const { name } = await context.params;

    if (!name) {
      return ApiErrors.badRequest('connection name is required');
    }

    const response = await fetch(
      `${BACKEND_URL}/api/csv/delete/${encodeURIComponent(name)}`,
      {
        method: 'DELETE',
        headers: {
          'x-company-id': user.companyId.toString(),
          'x-mode': user.mode
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return ApiErrors.externalApiError(data.message || 'Delete failed');
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
});
