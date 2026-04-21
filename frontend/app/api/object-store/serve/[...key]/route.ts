import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { handleApiError } from '@/lib/api/api-responses';
import { LOCAL_UPLOAD_PATH } from '@/lib/config';

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  csv: 'text/csv',
  parquet: 'application/octet-stream',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * GET /api/object-store/serve/{key}
 *
 * Publicly serves a file from the local filesystem (LOCAL_UPLOAD_PATH/{key}).
 * No auth required — keys are UUID-based and unguessable.
 * Used as the "public URL" for files when no S3 is configured (e.g. chart images sent to LLM).
 */
export async function GET(req: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  try {
    const { key: keyParts } = await context.params;
    const key = keyParts.join('/');

    const filePath = resolve(join(LOCAL_UPLOAD_PATH, key));
    // Prevent path traversal
    if (!filePath.startsWith(LOCAL_UPLOAD_PATH)) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const buffer = readFileSync(filePath);
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

    return new NextResponse(buffer, {
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
