import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { BACKEND_URL } from '@/lib/constants';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const formData = await request.formData();

    const response = await fetch(`${BACKEND_URL}/api/csv/upload`, {
      method: 'POST',
      headers: {
        'x-company-id': user.companyId.toString(),
        'x-mode': user.mode
      },
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      return ApiErrors.externalApiError(data.message || 'Upload failed');
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
});
