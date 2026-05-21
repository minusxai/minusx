import 'server-only';
import type { AgentAttachment } from '@/agents/analyst/types';

const DATA_URL_RE = /^data:([^;]+);base64,([\s\S]*)$/;

/** Convert image content (data: URL or http(s) URL) to base64 + mimeType. */
async function toBase64Image(content: string): Promise<{ data: string; mimeType: string } | null> {
  const dataUrl = content.match(DATA_URL_RE);
  if (dataUrl) return { mimeType: dataUrl[1], data: dataUrl[2] };

  if (/^https?:\/\//.test(content)) {
    try {
      const res = await fetch(content);
      if (!res.ok) return null;
      const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
      const data = Buffer.from(await res.arrayBuffer()).toString('base64');
      return { mimeType, data };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Normalize the client's attachment payload (agent_args.attachments) into
 * AgentAttachment[] for the LLM user message. Image attachments are converted
 * to base64 (pi has no remote-URL image support); text attachments pass
 * through with name + page count. Mirrors how Python splits attachments into
 * image_url blocks and <Attachment> text blocks.
 */
export async function normalizeAttachments(raw: unknown): Promise<AgentAttachment[]> {
  if (!Array.isArray(raw)) return [];
  const out: AgentAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const att = item as { type?: string; name?: string; content?: string; metadata?: { pages?: number } };
    if (!att.content) continue;
    if (att.type === 'image') {
      const img = await toBase64Image(att.content);
      if (img) out.push({ type: 'image', data: img.data, mimeType: img.mimeType });
    } else if (att.type === 'text') {
      out.push({ type: 'text', name: att.name, content: att.content, pages: att.metadata?.pages });
    }
  }
  return out;
}
