import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { deleteS3File } from '@/lib/csv-processor';

export const DELETE = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { s3_key } = body;

    if (!s3_key || typeof s3_key !== 'string') {
      return ApiErrors.badRequest('s3_key is required');
    }

    // Security: key must belong to this company
    if (!s3_key.startsWith(`${user.companyId}/`)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    await deleteS3File(s3_key);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
});
