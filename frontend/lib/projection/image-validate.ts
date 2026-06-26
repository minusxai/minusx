/**
 * Provider-image validation — mirrors what the LLM provider accepts, so malformed image content
 * fails in tests instead of as a 400 in production.
 *
 * The provider takes an image as EITHER a remote http(s) `url` OR inline base64 (`data` +
 * `mimeType`). A `data:` URL stuffed into `url` is the bug we shipped once (MIME came back
 * "undefined") — it must be split into `{ data, mimeType }`. These helpers encode that contract.
 */
import type { ImageContent, TextContent } from '@/orchestrator/llm';

const DATA_URL_RE = /^data:([^;]+);base64,(.*)$/;

/**
 * Normalize an image URL into a provider-valid {@link ImageContent}. A `data:` URL (dev/base64
 * uploads) MUST be split into `{ data, mimeType }` — sending it verbatim in `url` makes the provider
 * report an undefined MIME type. A remote http(s) URL (S3) is passed through as `url`. This is the
 * single source for that contract: reused by the app-state adapter (`from-compressed`) and the
 * tool-result resume mapping (`legacyToolResultToPi`).
 */
export function imageContentFromUrl(url: string): ImageContent {
  const m = DATA_URL_RE.exec(url);
  if (m) return { type: 'image', mimeType: m[1], data: m[2] };
  return { type: 'image', url };
}

export function isValidProviderImage(img: ImageContent): boolean {
  if (img.url !== undefined && img.url !== '') {
    // A remote URL is fine; a data: URL in `url` is NOT — it must be split to {data, mimeType}.
    return /^https?:\/\//.test(img.url);
  }
  return typeof img.data === 'string' && img.data.length > 0 && typeof img.mimeType === 'string' && img.mimeType.length > 0;
}

/** Throw if any image block in the content array is not provider-valid (reports why). */
export function assertValidProviderImages(content: ReadonlyArray<TextContent | ImageContent>): void {
  for (const block of content) {
    if (block.type !== 'image') continue;
    if (!isValidProviderImage(block)) {
      const why = block.url
        ? `image.url is not http(s): "${block.url.slice(0, 40)}…" (a data: URL must be split into {data, mimeType})`
        : 'image has no http(s) url and is missing data and/or mimeType';
      throw new Error(`Invalid provider image content — ${why}`);
    }
  }
}
