import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { deleteConnectionFiles } from '@/lib/csv-processor';

export const DELETE = withAuth(async (request: NextRequest, user, context) => {
  try {
    const { name } = await context.params;
    if (!name) return ApiErrors.badRequest('connection name is required');

    await deleteConnectionFiles(user.companyId, user.mode, name);

    return NextResponse.json({ success: true, message: `Connection '${name}' removed` });
  } catch (error) {
    return handleApiError(error);
  }
});
