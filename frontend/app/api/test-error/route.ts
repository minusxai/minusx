import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors } from '@/lib/api/api-responses';

/**
 * POST /api/test-error
 * Deliberately throws a server-side error to verify the bug reporting channel works.
 * Admin-only. Used by the Settings dev panel.
 */
export const POST = withAuth(async (_req: NextRequest, user) => {
  if (user.role !== 'admin') {
    return ApiErrors.forbidden('Admin only');
  }
  throw new Error('Test error: intentionally triggered from Settings dev panel');
});

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
