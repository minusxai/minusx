import 'server-only';

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  OBJECT_STORE_BUCKET,
  OBJECT_STORE_REGION,
  OBJECT_STORE_ACCESS_KEY_ID,
  OBJECT_STORE_SECRET_ACCESS_KEY,
  OBJECT_STORE_ENDPOINT,
  OBJECT_STORE_PUBLIC_URL,
} from '@/lib/config';
import type { ObjectStore, UploadUrlResult } from './index';

/**
 * S3Adapter — stores files in an S3-compatible bucket.
 * Supports AWS S3, MinIO, Cloudflare R2, and any S3-compatible endpoint.
 *
 * Required env vars (when OBJECT_STORE_PROVIDER=s3):
 *   OBJECT_STORE_BUCKET            Bucket name
 *   OBJECT_STORE_REGION            AWS region (e.g. us-east-1)
 *   OBJECT_STORE_ACCESS_KEY_ID     AWS access key
 *   OBJECT_STORE_SECRET_ACCESS_KEY AWS secret key
 *
 * Optional env vars:
 *   OBJECT_STORE_ENDPOINT    Custom endpoint URL for S3-compatible stores (MinIO, R2, etc.)
 *   OBJECT_STORE_PUBLIC_URL  Public URL prefix for objects (e.g. CDN URL).
 *                            Defaults to `https://{bucket}.s3.{region}.amazonaws.com`
 */
export class S3Adapter implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor() {
    const COMMON_ERROR = 'Image Upload is not supported.'
    if (!OBJECT_STORE_BUCKET) throw new Error(COMMON_ERROR);
    if (!OBJECT_STORE_ACCESS_KEY_ID) throw new Error(COMMON_ERROR);
    if (!OBJECT_STORE_SECRET_ACCESS_KEY) throw new Error(COMMON_ERROR);

    this.bucket = OBJECT_STORE_BUCKET;
    this.publicUrlBase =
      OBJECT_STORE_PUBLIC_URL ??
      (OBJECT_STORE_ENDPOINT
        ? `${OBJECT_STORE_ENDPOINT}/${OBJECT_STORE_BUCKET}`
        : `https://${OBJECT_STORE_BUCKET}.s3.${OBJECT_STORE_REGION}.amazonaws.com`);

    this.client = new S3Client({
      region: OBJECT_STORE_REGION,
      credentials: {
        accessKeyId: OBJECT_STORE_ACCESS_KEY_ID,
        secretAccessKey: OBJECT_STORE_SECRET_ACCESS_KEY,
      },
      ...(OBJECT_STORE_ENDPOINT ? { endpoint: OBJECT_STORE_ENDPOINT, forcePathStyle: true } : {}),
    });
  }

  async getUploadUrl({ key, contentType }: { key: string; contentType: string }): Promise<UploadUrlResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: 300 });
    const publicUrl = `${this.publicUrlBase}/${key}`;

    return { uploadUrl, publicUrl };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
