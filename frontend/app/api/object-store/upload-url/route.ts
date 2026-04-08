import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { createObjectStore, generateUploadKey } from '@/lib/object-store';
import { immutableSet } from '@/lib/utils/immutable-collections';

/**
 * MIME types the server will issue presigned URLs for.
 * Prevents authenticated users from hosting arbitrary content (e.g. text/html)
 * under the app's S3 domain, which could be used for phishing or XSS.
 */
const ALLOWED_CONTENT_TYPES = immutableSet([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

/** 50 MB — presigned PUT URLs can't enforce this at S3 level, so we document the intent here.
 *  Client-side enforcement is in client.ts. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * GET /api/object-store/upload-url?filename={name}&contentType={mime}
 *
 * Returns a presigned PUT URL for direct client-side upload and the
 * resulting public URL of the object.
 *
 * The client should:
 *   1. PUT the file to uploadUrl (directly to S3)
 *   2. Store and use publicUrl going forward
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const filename = req.nextUrl.searchParams.get('filename');
    const contentType = req.nextUrl.searchParams.get('contentType');

    if (!filename || !contentType) {
      return NextResponse.json(
        { error: 'filename and contentType query parameters are required' },
        { status: 400 },
      );
    }

    // Reject disallowed MIME types before issuing a presigned URL.
    // This prevents uploading executable content (text/html, application/javascript, etc.)
    // that could be hosted under the app's S3 domain.
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${contentType}` },
        { status: 415 },
      );
    }

    const key = generateUploadKey(user.companyId, filename);
    const store = createObjectStore();
    const result = await store.getUploadUrl({ key, contentType });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
