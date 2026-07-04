/**
 * USE_BASE64_UPLOADS contract — pinned.
 *
 * When the flag is on, EVERY image upload gets the `base64:` sentinel and the client embeds the
 * image as a data URL — regardless of what the image is for (chat attachment, dashboard text
 * block, context doc, notebook cell). Deployments set this flag precisely because they have no
 * usable object store (ephemeral FS, no S3); routing any image upload to the store there would
 * break uploads or mint URLs that die on restart. The perf cost of data URLs in file content on
 * such deployments is ACCEPTED — do not "fix" it by bypassing the flag per-callsite.
 */

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

describe('upload-url — USE_BASE64_UPLOADS applies to ALL image uploads', () => {
  beforeEach(() => {
    (getEffectiveUser as Mock).mockResolvedValue(USER);
  });

  it('chart-attachment images get the base64 sentinel', async () => {
    const res = await GET(request({ filename: 'chart.jpg', contentType: 'image/jpeg', keyType: 'charts' }));
    expect(res.status).toBe(200);
    expect((await res.json()).uploadUrl).toBe('base64:');
  });

  it('general/content images ALSO get the base64 sentinel (no per-callsite bypass)', async () => {
    const res = await GET(request({ filename: 'photo.png', contentType: 'image/png' }));
    expect(res.status).toBe(200);
    expect((await res.json()).uploadUrl).toBe('base64:');
  });

  it('non-image files still use the real object store even with the flag on', async () => {
    const res = await GET(request({ filename: 'data.csv', contentType: 'text/csv' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).not.toBe('base64:');
    expect(body.uploadUrl).toContain('https://');
  });
});
