/**
 * GET /api/object-store/upload-url — route integration test
 *
 * Verifies:
 *  - Returns 200 with { uploadUrl, publicUrl } for a valid authenticated request
 *  - Returns 400 when filename or contentType is missing
 *  - Returns 401 when the user is not authenticated
 *  - uploadUrl and publicUrl reflect the values returned by the ObjectStore
 */

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_upload_url_route.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
    DB_TYPE: 'sqlite',
  };
});

jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: jest.fn(),
}));

// Mock the entire object-store module so the route never touches real S3
jest.mock('@/lib/object-store', () => {
  const { randomUUID } = require('crypto');
  const { extname } = require('path');
  return {
    createObjectStore: jest.fn(() => ({
      getUploadUrl: jest.fn(async ({ key }: { key: string }) => ({
        uploadUrl: `https://bucket.s3.amazonaws.com/${key}?X-Amz-Signature=mock`,
        publicUrl: `https://bucket.s3.amazonaws.com/${key}`,
      })),
      delete: jest.fn(),
    })),
    generateUploadKey: (companyId: number, filename: string) => {
      const ext = extname(filename).toLowerCase();
      return `${companyId}/${randomUUID()}${ext}`;
    },
  };
});

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/object-store/upload-url/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';

const mockUser = {
  companyId: 42,
  companyName: 'test',
  userId: 1,
  email: 'test@test.com',
  role: 'admin' as const,
  homeFolder: '/org',
  mode: 'org' as const,
};

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('/api/object-store/upload-url', 'http://localhost:3000');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

beforeEach(() => {
  (getEffectiveUser as jest.Mock).mockResolvedValue(mockUser);
});

describe('GET /api/object-store/upload-url', () => {
  it('returns 200 with uploadUrl and publicUrl', async () => {
    const req = makeRequest({ filename: 'photo.png', contentType: 'image/png' });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.uploadUrl).toMatch(/^https:\/\/bucket\.s3\.amazonaws\.com\/.+\?X-Amz-Signature=mock$/);
    expect(body.publicUrl).toMatch(/^https:\/\/bucket\.s3\.amazonaws\.com\/.+\.png$/);
  });

  it('key contains companyId and preserves extension', async () => {
    const req = makeRequest({ filename: 'diagram.svg', contentType: 'image/svg+xml' });
    const res = await GET(req);
    const { publicUrl } = await res.json();
    expect(publicUrl).toMatch(/\/42\/.+\.svg$/);
  });

  it('returns 400 when filename is missing', async () => {
    const req = makeRequest({ contentType: 'image/png' });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when contentType is missing', async () => {
    const req = makeRequest({ filename: 'photo.png' });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated (null user)', async () => {
    (getEffectiveUser as jest.Mock).mockResolvedValue(null);
    const req = makeRequest({ filename: 'photo.png', contentType: 'image/png' });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
