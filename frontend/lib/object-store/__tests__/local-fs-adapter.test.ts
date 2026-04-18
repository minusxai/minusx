import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

jest.mock('@/lib/config', () => ({
  LOCAL_UPLOAD_PATH: join(require('os').tmpdir(), `local-fs-adapter-test-${require('crypto').randomUUID()}`),
  NEXTAUTH_SECRET: 'test-secret',
}));

// Import after mock so LOCAL_UPLOAD_PATH is resolved
import { LocalFsAdapter } from '@/lib/object-store/local-fs-adapter';
import { LOCAL_UPLOAD_PATH } from '@/lib/config';

let adapter: LocalFsAdapter;

beforeEach(() => {
  adapter = new LocalFsAdapter();
  mkdirSync(LOCAL_UPLOAD_PATH, { recursive: true });
});

afterAll(() => {
  try { rmSync(LOCAL_UPLOAD_PATH, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('LocalFsAdapter', () => {
  describe('put / serve URL', () => {
    it('writes file to disk and returns serve URL', async () => {
      const key = `1/csvs/org/conn/${randomUUID()}.parquet`;
      const content = Buffer.from('hello parquet');

      const publicUrl = await adapter.put(key, content, 'application/octet-stream');

      expect(publicUrl).toBe(`/api/object-store/serve/${key}`);
      expect(existsSync(join(LOCAL_UPLOAD_PATH, key))).toBe(true);
      expect(readFileSync(join(LOCAL_UPLOAD_PATH, key))).toEqual(content);
    });

    it('creates intermediate directories', async () => {
      const key = `1/csvs/org/deep/nested/${randomUUID()}.csv`;
      await adapter.put(key, Buffer.from('data'), 'text/csv');
      expect(existsSync(join(LOCAL_UPLOAD_PATH, key))).toBe(true);
    });
  });

  describe('getUploadUrl', () => {
    it('returns local-upload PUT URL and serve public URL', async () => {
      const key = `1/csvs/org/conn/${randomUUID()}.csv`;
      const { uploadUrl, publicUrl } = await adapter.getUploadUrl({ key, contentType: 'text/csv' });

      expect(uploadUrl).toContain('/api/object-store/local-upload?key=');
      expect(uploadUrl).toContain(encodeURIComponent(key));
      expect(publicUrl).toBe(`/api/object-store/serve/${key}`);
    });
  });

  describe('delete', () => {
    it('removes existing file', async () => {
      const key = `1/csvs/org/conn/${randomUUID()}.csv`;
      await adapter.put(key, Buffer.from('x'), 'text/csv');
      expect(existsSync(join(LOCAL_UPLOAD_PATH, key))).toBe(true);

      await adapter.delete(key);
      expect(existsSync(join(LOCAL_UPLOAD_PATH, key))).toBe(false);
    });

    it('does not throw for missing file', async () => {
      await expect(adapter.delete(`1/csvs/org/conn/${randomUUID()}.csv`)).resolves.toBeUndefined();
    });
  });

  describe('copyObject', () => {
    it('copies file to new key', async () => {
      const src = `1/csvs/org/conn/${randomUUID()}.parquet`;
      const dst = `1/csvs/org/conn/${randomUUID()}.parquet`;
      const content = Buffer.from('parquet bytes');
      await adapter.put(src, content, 'application/octet-stream');

      await adapter.copyObject(src, dst);

      expect(readFileSync(join(LOCAL_UPLOAD_PATH, dst))).toEqual(content);
      // Source still exists (copy, not move)
      expect(existsSync(join(LOCAL_UPLOAD_PATH, src))).toBe(true);
    });
  });

  describe('path traversal protection', () => {
    it('rejects keys that escape the upload root', async () => {
      await expect(adapter.put('../../etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow('Invalid storage key');
      await expect(adapter.delete('../../etc/passwd')).rejects.toThrow('Invalid storage key');
    });
  });
});
