/**
 * Remote Agent Sessions — result-content serializer: the orchestrator's own
 * `(TextContent | ImageContent)[]` → wire `RemoteContentBlock[]`.
 *
 * Reuses the app's existing attachment semantics per deployment (REMOTE_AGENT_SESSIONS.md §7):
 * absolute public URLs (S3/CDN) pass through; `data:` URLs and base64 blocks pass through as
 * base64; the local object store's `/api/object-store/serve/<key>` URLs are **auth-gated and
 * relative** — unreachable for an external agent — so they are inlined as base64 by reading the
 * blob server-side. Anything unreadable degrades to a text note instead of a broken block.
 */
import 'server-only';
import type { ImageContent, TextContent } from '@/orchestrator/llm';
import type { RemoteContentBlock } from '@/lib/data/remote-sessions.types';
import { createObjectStore } from '@/lib/object-store';

const SERVE_ROUTE_PREFIX = '/api/object-store/serve/';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export interface SerializeRemoteContentOpts {
  /** Blob reader for serve-route keys — injectable for tests; defaults to the object store. */
  readBlob?: (key: string) => Promise<{ data: Buffer; contentType: string } | null>;
}

async function readFromObjectStore(key: string): Promise<{ data: Buffer; contentType: string } | null> {
  const data = await createObjectStore().get(key);
  if (!data) return null;
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return { data, contentType: MIME_BY_EXT[ext] ?? 'application/octet-stream' };
}

function parseDataUrl(url: string): { data: string; mimeType: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

export async function serializeRemoteContent(
  blocks: (TextContent | ImageContent)[],
  opts: SerializeRemoteContentOpts = {},
): Promise<RemoteContentBlock[]> {
  const readBlob = opts.readBlob ?? readFromObjectStore;
  const out: RemoteContentBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      out.push({ type: 'text', text: block.text });
      continue;
    }
    // image
    if (block.data) {
      out.push({ type: 'image', data: block.data, mimeType: block.mimeType ?? 'image/jpeg' });
      continue;
    }
    const url = block.url ?? '';
    const dataUrl = parseDataUrl(url);
    if (dataUrl) {
      out.push({ type: 'image', ...dataUrl });
      continue;
    }
    if (/^https?:\/\//i.test(url)) {
      out.push({ type: 'image', url });
      continue;
    }
    if (url.startsWith(SERVE_ROUTE_PREFIX)) {
      const key = decodeURIComponent(url.slice(SERVE_ROUTE_PREFIX.length).split('?')[0]);
      const blob = await readBlob(key);
      if (blob) {
        out.push({ type: 'image', data: blob.data.toString('base64'), mimeType: blob.contentType });
        continue;
      }
    }
    out.push({ type: 'text', text: `[image unavailable to remote agents: ${url || '(empty url)'}]` });
  }
  return out;
}
