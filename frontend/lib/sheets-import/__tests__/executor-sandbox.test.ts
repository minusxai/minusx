/**
 * The DuckDB sandbox must allow the local temp directory in BOTH object-store modes:
 * materializeTransforms always COPYs to a local temp file before store.put, so an
 * S3-backed deployment that only allows the s3:// prefix breaks every confirm with
 * "Permission Error: Cannot access file /var/folders/…" (found in browser verification).
 */
import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'os';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  OBJECT_STORE_BUCKET: 'test-bucket',
  OBJECT_STORE_ACCESS_KEY_ID: 'test-key',
  LOCAL_UPLOAD_PATH: '/data/uploads',
}));

import { sandboxAllowedDirs } from '@/lib/sheets-import/executor';

describe('sandboxAllowedDirs', () => {
  it('S3 mode allows the connection prefix AND the local temp dir (COPY target)', () => {
    const dirs = sandboxAllowedDirs('org', 'static');
    expect(dirs).toContain('s3://test-bucket/csvs/org/static/');
    expect(dirs.some((d) => d.startsWith(`${tmpdir()}/`) || d === `${tmpdir()}/`)).toBe(true);
  });
});
