import 'server-only';

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';
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

    // Cast: installing @aws-sdk/lib-storage bumped @smithy/types, making S3Client
    // and getSignedUrl's expected Client type skew. Harmless — same client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uploadUrl = await getSignedUrl(this.client as any, command, { expiresIn: 300 });
    const publicUrl = `${this.publicUrlBase}/${key}`;

    return { uploadUrl, publicUrl };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return `${this.publicUrlBase}/${key}`;
  }

  async putStream(key: string, body: Readable, contentType = 'application/octet-stream'): Promise<void> {
    // Multipart streaming upload — never buffers the whole object in memory.
    const upload = new Upload({
      // Cast: @aws-sdk/lib-storage pins a slightly different @smithy client type
      // than our @aws-sdk/client-s3 version (harmless version skew).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: this.client as any,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
    });
    await upload.done();
  }

  async getStream(key: string): Promise<Readable | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      // In Node, Body is a Readable stream.
      return (res.Body as Readable | undefined) ?? null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Server-side S3 copy — no data transfer through Node.js. */
  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${sourceKey}`,
      Key: destKey,
    }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(key: string): string {
    return `${this.publicUrlBase}/${key}`;
  }
}
