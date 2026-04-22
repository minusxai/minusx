import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { createObjectStore, generateUploadKey, generateCsvUploadKey } from '@/lib/object-store';
import { signStorageToken } from '@/lib/object-store/key-token';
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
  // Remote-file (CSV/Parquet/Excel) uploads
  'application/octet-stream',  // Parquet files
  'application/vnd.apache.parquet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // xlsx
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
    const keyTypeParam = req.nextUrl.searchParams.get('keyType');

    if (!filename || !contentType) {
      return NextResponse.json(
        { error: 'filename and contentType query parameters are required' },
        { status: 400 },
      );
    }

    // Reject disallowed MIME types before issuing a presigned URL.
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${contentType}` },
        { status: 415 },
      );
    }

    let key: string;
    if (keyTypeParam === 'csvs') {
      // CSV uploads use a connection-scoped key.
      // connectionName is required for csvs key type.
      const connectionName = req.nextUrl.searchParams.get('connectionName');
      if (!connectionName) {
        return NextResponse.json(
          { error: 'connectionName is required for keyType=csvs' },
          { status: 400 },
        );
      }
      key = generateCsvUploadKey({
        mode: user.mode,
        connectionName,
        filename,
      });
    } else {
      const keyType = keyTypeParam === 'charts' ? 'charts' : 'uploads';
      const ext = '.' + filename.split('.').pop()!.toLowerCase();
      key = generateUploadKey({
        userId: user.userId,
        mode: user.mode,
        type: keyType,
        ext,
      });
    }

    const store = createObjectStore();
    const result = await store.getUploadUrl({ key, contentType });

    // Sign the key into a tamper-proof token so /api/csv/register can trust
    // the echoed-back key without mode-specific validation.
    return NextResponse.json({ ...result, s3Key: signStorageToken(key) });
  } catch (error) {
    return handleApiError(error);
  }
}
