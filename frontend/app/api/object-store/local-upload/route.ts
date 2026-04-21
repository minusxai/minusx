import { NextRequest, NextResponse } from 'next/server';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { LOCAL_UPLOAD_PATH } from '@/lib/config';

/**
 * PUT /api/object-store/local-upload?key={key}
 *
 * Receives a file body and writes it to the local filesystem at LOCAL_UPLOAD_PATH/{key}.
 * Used by the browser upload flow when no S3 credentials are configured.
 * The client treats this URL exactly like an S3 presigned PUT URL.
 */
export async function PUT(req: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const key = req.nextUrl.searchParams.get('key');
    if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });

    const filePath = resolve(join(LOCAL_UPLOAD_PATH, key));
    // Prevent path traversal
    if (!filePath.startsWith(LOCAL_UPLOAD_PATH)) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }

    mkdirSync(dirname(filePath), { recursive: true });
    const body = await req.arrayBuffer();
    writeFileSync(filePath, Buffer.from(body));

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
