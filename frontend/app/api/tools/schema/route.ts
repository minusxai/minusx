import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors } from '@/lib/api/api-responses';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';

export const GET = withAuth(async (_request, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }
  const response = await pythonBackendFetch('/api/tools/schema');
  const data = await response.json();
  return NextResponse.json(data);
});
