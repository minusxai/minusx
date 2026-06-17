import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { setStoryPreview } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';

// Stores a client-captured OG preview image (an upload URL or data URL) for a story,
// used as the background of its social share card. The server FilesAPI enforces access +
// story type; this route is thin.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/files/[id]/preview — set the story's OG preview image. Body: { url } */
export const POST = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const id = validateFileId((await params).id);
    const body = await request.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url : null;
    if (!url) return ApiErrors.validationError('url is required');
    await setStoryPreview(id, user, url);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});
