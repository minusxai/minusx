import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { addShare, getShares, revokeShare } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';

// Admin-only management of public share links for a story file.
// The server FilesAPI enforces admin role + story type; routes are thin.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/files/[id]/share — list this story's share links (admin-only). */
export const GET = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const id = validateFileId((await params).id);
    const shares = await getShares(id, user);
    return successResponse({ shares });
  } catch (error) {
    return handleApiError(error);
  }
});

/** POST /api/files/[id]/share — mint a new share link (admin-only). Body: { label? } */
export const POST = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const id = validateFileId((await params).id);
    const body = await request.json().catch(() => ({}));
    const label = typeof body?.label === 'string' ? body.label : undefined;
    const { shareableId, record } = await addShare(id, user, label);
    // Return a relative path; the client composes the absolute URL from its own origin.
    return successResponse({ shareableId, path: `/l/${shareableId}`, record });
  } catch (error) {
    return handleApiError(error);
  }
});

/** DELETE /api/files/[id]/share?nonce=... — revoke a share link (admin-only). */
export const DELETE = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const id = validateFileId((await params).id);
    const nonce = request.nextUrl.searchParams.get('nonce');
    if (!nonce) return ApiErrors.validationError('nonce is required');
    const revoked = await revokeShare(id, user, nonce);
    return successResponse({ revoked });
  } catch (error) {
    return handleApiError(error);
  }
});
