/**
 * POST /api/relationships/verify — run the two relationship checks (target
 * uniqueness + FK match rate) against the live connection. Used by the
 * Verify button in the whitelist relationships editor.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { verifyRelationship } from '@/lib/semantic/verify.server';
import type { TableRelationship } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const { relationship } = (await request.json()) as { relationship?: TableRelationship };
    if (!relationship || typeof relationship !== 'object') {
      return ApiErrors.badRequest('relationship is required');
    }
    const result = await verifyRelationship(user, relationship);
    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
});
