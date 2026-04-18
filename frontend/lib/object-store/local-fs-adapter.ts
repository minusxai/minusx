import 'server-only';

import { mkdirSync, writeFileSync, unlinkSync, copyFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { LOCAL_UPLOAD_PATH } from '@/lib/config';
import type { ObjectStore, UploadUrlResult } from './index';

/**
 * LocalFsAdapter — stores files on the local filesystem.
 * Used as a fallback when S3 credentials are not configured (self-hosted setups).
 *
 * Files are stored at LOCAL_UPLOAD_PATH/{key} (default: data/uploads/{key}).
 * Upload URL: /api/object-store/local-upload?key={key}  (PUT, auth-gated)
 * Public URL:  /api/object-store/serve/{key}            (GET, auth-gated)
 *
 * Note: "public" URLs are auth-gated Next.js routes, not truly public.
 * LLM chart attachments won't be reachable from external Claude API calls
 * unless the app is publicly accessible, which is acceptable for self-hosted setups.
 */
export class LocalFsAdapter implements ObjectStore {
  private readonly root: string;

  constructor() {
    this.root = LOCAL_UPLOAD_PATH;
  }

  private resolvePath(key: string): string {
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root)) throw new Error('Invalid storage key');
    return full;
  }

  async getUploadUrl({ key }: { key: string; contentType: string }): Promise<UploadUrlResult> {
    return {
      uploadUrl: `/api/object-store/local-upload?key=${encodeURIComponent(key)}`,
      publicUrl: `/api/object-store/serve/${key}`,
    };
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<string> {
    const filePath = this.resolvePath(key);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, body);
    return `/api/object-store/serve/${key}`;
  }

  async delete(key: string): Promise<void> {
    try {
      unlinkSync(this.resolvePath(key));
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    const src = this.resolvePath(sourceKey);
    const dest = this.resolvePath(destKey);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}
