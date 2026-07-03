/**
 * USE_BASE64_UPLOADS must only affect EPHEMERAL images (chat/chart attachments). An image that is
 * uploaded for PERSISTENT file content (dashboard text blocks, context docs, notebook cells) must
 * get a real object-store URL: a multi-hundred-KB data URL embedded in file content rides through
 * every dirty-check serialization, markup build, LLM payload, and DB row forever.
 * Callers declare intent with `persistent=true`.
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

vi.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: vi.fn(),
}));

vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  USE_BASE64_UPLOADS: true,
}));

vi.mock('@/lib/object-store', () => {
  const { randomUUID } = require('crypto');
  return {
    createObjectStore: vi.fn(() => ({
      getUploadUrl: vi.fn(async ({ key }: { key: string }) => ({
        uploadUrl: `https://bucket.s3.amazonaws.com/${key}?X-Amz-Signature=mock`,
        publicUrl: `https://bucket.s3.amazonaws.com/${key}`,
      })),
      delete: vi.fn(),
    })),
    generateUploadKey: ({ ext }: { userId: number; mode: string; type: string; ext: string }) =>
      `uploads/${randomUUID()}${ext}`,
  };
});

import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/object-store/upload-url/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';

const USER = { userId: 1, email: 't@example.com', name: 'T', role: 'admin', home_folder: '/org', mode: 'org' };

function request(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/object-store/upload-url');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe('upload-url — USE_BASE64_UPLOADS scoping', () => {
  beforeEach(() => {
    (getEffectiveUser as Mock).mockResolvedValue(USER);
  });

  it('returns the base64 sentinel for an EPHEMERAL image upload (default)', async () => {
    const res = await GET(request({ filename: 'chart.jpg', contentType: 'image/jpeg', keyType: 'charts' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBe('base64:');
  });

  it('returns a REAL upload URL for a persistent=true image upload (file content)', async () => {
    const res = await GET(request({ filename: 'photo.png', contentType: 'image/png', persistent: 'true' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).not.toBe('base64:');
    expect(body.uploadUrl).toContain('https://');
    expect(body.publicUrl).toContain('https://');
  });
});
