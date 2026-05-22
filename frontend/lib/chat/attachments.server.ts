import 'server-only';
import type { AgentAttachment } from '@/agents/analyst/types';

const DATA_URL_RE = /^data:([^;]+);base64,([\s\S]*)$/;

/**
 * Normalize the client's attachment payload (agent_args.attachments) into
 * AgentAttachment[] for the LLM user message. Image attachments become either a
 * base64 image (`data:` URL) or a remote-URL image (http(s) — Anthropic loads
 * the URL directly via the pi patch; our server never fetches it, so there is
 * no SSRF surface). Text attachments pass through with name + page count.
 * Mirrors how Python splits attachments into image blocks and <Attachment>
 * text blocks.
 */
export function normalizeAttachments(raw: unknown): AgentAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const att = item as { type?: string; name?: string; content?: string; metadata?: { pages?: number } };
    if (!att.content) continue;
    if (att.type === 'image') {
      const m = att.content.match(DATA_URL_RE);
      if (m) out.push({ type: 'image', mimeType: m[1], data: m[2] });
      else if (/^https?:\/\//.test(att.content)) out.push({ type: 'image', url: att.content });
    } else if (att.type === 'text') {
      out.push({ type: 'text', name: att.name, content: att.content, pages: att.metadata?.pages });
    }
  }
  return out;
}
