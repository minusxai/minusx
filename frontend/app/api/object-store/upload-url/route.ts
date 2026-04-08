import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { createObjectStore, generateUploadKey } from '@/lib/object-store';

/**
 * GET /api/object-store/upload-url?filename={name}&contentType={mime}
 *
 * Returns a presigned PUT URL for direct client-side upload and the
 * resulting public URL of the object.
 *
 * The client should:
 *   1. PUT the file to uploadUrl (directly to S3, or to our local upload route)
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

    const key = generateUploadKey(user.companyId, filename);
    const store = createObjectStore();
    const result = await store.getUploadUrl({ key, contentType });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
