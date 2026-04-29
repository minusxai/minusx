/**
 * Client-side upload helper for the ObjectStore.
 *
 * Flow:
 *   1. Request a presigned PUT URL from /api/object-store/upload-url
 *   2. PUT the file directly to the returned uploadUrl (S3) or to the local upload route
 *   3. Return the publicUrl for use in attachments, markdown, etc.
 */

import { IS_DEV, USE_BASE64_UPLOADS } from '@/lib/constants';

export interface UploadResult {
  publicUrl: string;
}

/** 50 MB client-side guard — S3 presigned PUT URLs cannot enforce ContentLengthRange,
 *  so we reject oversized files before even requesting a URL. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Upload a blob to the object store and return a usable URL.
 *
 * Decision order:
 *   1. USE_BASE64_UPLOADS=true  → skip API call, return base64 data URL
 *   2. Local FS adapter + IS_DEV → return base64 data URL (localhost unreachable by LLM)
 *   3. Local FS adapter + !IS_DEV → upload to local FS, return absolute origin URL
 *   4. S3                        → upload, return public URL
 */
export async function uploadBlobOrEmbed(
  blob: Blob,
  filename: string,
  contentType: string,
): Promise<string> {
  if (USE_BASE64_UPLOADS) {
    return blobToDataUrl(blob);
  }

  const params = new URLSearchParams({ filename, contentType, keyType: 'charts' });
  const res = await fetch(`/api/object-store/upload-url?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new Error(message ?? `Failed to get upload URL (${res.status})`);
  }
  const { uploadUrl, publicUrl } = (await res.json()) as { uploadUrl: string; publicUrl: string };

  if (uploadUrl.startsWith('/api/object-store/local-upload')) {
    if (IS_DEV) {
      return blobToDataUrl(blob);
    }
    const putRes = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } });
    if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
    return `${window.location.origin}${publicUrl}`;
  }

  const putRes = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } });
  if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
  return publicUrl;
}

/**
 * Upload any file to the object store.
 *
 * @param file        The File object to upload
 * @param onProgress  Optional callback receiving upload progress 0–1 (via XHR)
 * @returns           The public URL of the uploaded file
 */
export async function uploadFile(
  file: File,
  onProgress?: (progress: number) => void,
  options?: { keyType?: 'uploads' | 'charts' },
): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large (max 50 MB)`);
  }

  if (USE_BASE64_UPLOADS) {
    return { publicUrl: await blobToDataUrl(file) };
  }

  const params = new URLSearchParams({ filename: file.name, contentType: file.type });
  if (options?.keyType) params.set('keyType', options.keyType);
  const res = await fetch(`/api/object-store/upload-url?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new Error(message ?? `Failed to get upload URL (${res.status})`);
  }
  const { uploadUrl, publicUrl } = (await res.json()) as { uploadUrl: string; publicUrl: string };

  if (onProgress) {
    await uploadWithProgress(uploadUrl, file, onProgress);
  } else {
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });
    if (!putRes.ok) {
      throw new Error(`Upload failed (${putRes.status})`);
    }
  }

  return { publicUrl };
}

function uploadWithProgress(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}
