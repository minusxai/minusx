import type { Context, ImageContent, Message, TextContent } from '@/orchestrator/llm';
import { immutableMap } from '@/lib/utils/immutable-collections';

export interface ContextSizeSection {
  key: string;
  label: string;
  tokens: number;
  chars: number;
}

export interface ContextSizeEstimate {
  totalTokens: number;
  totalChars: number;
  method: 'estimated';
  sections: ContextSizeSection[];
}

// The provider's prompt cache covers a contiguous PREFIX of the WIRE serialization, which is:
// system prompt → tool definitions → PRIOR-turn messages (conversation + tool-call history). Only
// these "stable" sections can be cached, and this is the order the cached prefix fills.
const CACHEABLE_WIRE_ORDER = [
  'system_prompt',
  'tool_definitions',
  'conversation_history',
  'tool_call_history',
  'misc_other',
] as const;

/**
 * How many tokens of EACH section were served from the provider's prompt cache last turn.
 *
 * `cachedTokens` (usage.cacheRead) is the length of the cached prefix. That prefix only ever covers
 * the STABLE sections ({@link CACHEABLE_WIRE_ORDER}); the CURRENT turn's content (app state, file
 * markup, attachments, and the not-yet-sent next user message) is fresh and is never cached — it
 * always reports 0, no matter how large the prefix. The prefix is distributed across the cacheable
 * sections in wire order; a section straddling the boundary is approximate (the boundary is the
 * provider's exact token count, the section sizes are char-based estimates). Returns a number per
 * section, positionally aligned to `sections`.
 */
export function cachedTokensPerSection(
  sections: ContextSizeSection[],
  cachedTokens: number | undefined,
): number[] {
  const tokensByKey = new Map(sections.map((s) => [s.key, s.tokens]));
  const cachedByKey = new Map<string, number>();
  let remaining = Math.max(0, cachedTokens ?? 0);
  for (const key of CACHEABLE_WIRE_ORDER) {
    const tokens = tokensByKey.get(key);
    if (tokens === undefined) continue;
    const take = Math.min(tokens, remaining);
    cachedByKey.set(key, take);
    remaining -= take;
  }
  return sections.map((section) => cachedByKey.get(section.key) ?? 0);
}

const APPROX_CHARS_PER_TOKEN = 4;
const IMAGE_TOKEN_ESTIMATE = 1_000;
// The next user message hasn't been typed yet — reserve a flat approximation for it.
const NEXT_USER_MESSAGE_TOKEN_ESTIMATE = 100;

// Single source of truth for the breakdown sections: both display ORDER and LABELS.
// Reorder these entries to reorder the legend + colored squares; edit `label` to
// rename. Any section whose key is missing here is appended last, in computed order.
const SECTIONS = [
  { key: 'system_prompt', label: 'System prompt' },
  { key: 'tool_definitions', label: 'Tool definitions' },
  { key: 'app_state', label: 'App state' },
  { key: 'file_markup', label: 'File markup' },
  { key: 'conversation_history', label: 'Conv Text history' },
  { key: 'tool_call_history', label: 'Conv Toolcall history' },
  { key: 'text_attachments', label: 'Text attachments' },
  { key: 'image_attachments', label: 'Images attachments' },
  { key: 'misc_other', label: 'Misc / other' },
  { key: 'next_user_message', label: 'Next user msg approx' },
] as const;


const SECTION_RANK = immutableMap<string, number>(SECTIONS.map((s, i) => [s.key, i]));
const SECTION_LABELS = immutableMap<string, string>(SECTIONS.map((s) => [s.key, s.label]));

function labelFor(key: string): string {
  return SECTION_LABELS.get(key) ?? key;
}

function orderSections(sections: ContextSizeSection[]): ContextSizeSection[] {
  const rank = (key: string) => SECTION_RANK.get(key) ?? SECTION_RANK.size;
  return [...sections].sort((a, b) => rank(a.key) - rank(b.key));
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN));
}

function estimateJsonTokens(value: unknown): { tokens: number; chars: number } {
  const text = value == null ? '' : JSON.stringify(value);
  return { tokens: estimateTextTokens(text), chars: text.length };
}

function addSection(sections: ContextSizeSection[], key: string, text: string): void {
  sections.push({ key, label: labelFor(key), tokens: text ? estimateTextTokens(text) : 0, chars: text.length });
}

function addTokenSection(sections: ContextSizeSection[], key: string, tokens: number, chars = 0): void {
  sections.push({ key, label: labelFor(key), tokens: Math.max(0, tokens), chars });
}

function contentToText(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function countImages(content: Message['content']): number {
  if (typeof content === 'string') return 0;
  return content.filter((c): c is ImageContent => c.type === 'image').length;
}

function extractTagged(text: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'g');
  return Array.from(text.matchAll(re), (m) => m[1] ?? '');
}

function stripTagged(text: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`<${escaped}[^>]*>[\\s\\S]*?<\\/${escaped}>`, 'g'), '');
}

function splitCurrentUserMessage(message: Message | undefined, sections: ContextSizeSection[]): void {
  const text = message ? contentToText(message.content) : '';
  const images = message ? countImages(message.content) : 0;
  addTokenSection(sections, 'image_attachments', images * IMAGE_TOKEN_ESTIMATE);

  const appState = extractTagged(text, 'AppState').join('\n');
  addSection(sections, 'app_state', appState);

  const attachments = extractTagged(text, 'Attachment').join('\n');
  addSection(sections, 'text_attachments', attachments);

  const fileMarkup = extractTagged(text, 'file_markup').join('\n');
  addSection(sections, 'file_markup', fileMarkup);

  // Everything left after stripping the known blocks (incl. the <CurrentDate> line)
  // is lumped into "Misc / other".
  const withoutContextBlocks = ['AppState', 'Attachment', 'file_markup']
    .reduce((acc, tag) => stripTagged(acc, tag), text);
  const wrapper = withoutContextBlocks.split(/\n/).filter(Boolean).join('\n');
  addSection(sections, 'misc_other', wrapper);

  // The upcoming user message isn't known yet — reserve a flat estimate for it.
  addTokenSection(sections, 'next_user_message', NEXT_USER_MESSAGE_TOKEN_ESTIMATE);
}

export function estimateContextSize(context: Context): ContextSizeEstimate {
  const sections: ContextSizeSection[] = [];

  addSection(sections, 'system_prompt', context.systemPrompt ?? '');

  const tools = estimateJsonTokens(context.tools ?? []);
  addTokenSection(sections, 'tool_definitions', tools.tokens, tools.chars);

  const messages = context.messages ?? [];
  const currentUser = messages.at(-1);
  const history = messages.slice(0, -1);

  const historyText = history.map((m) => {
    const role = 'role' in m ? m.role : 'message';
    return `${role}\n${contentToText(m.content)}`;
  }).join('\n\n');
  addSection(sections, 'conversation_history', historyText);

  const historicalToolCalls = history
    .filter((m) => 'role' in m && m.role === 'assistant' && Array.isArray(m.content))
    .flatMap((m) => (m.content as Array<{ type?: string }>).filter((c) => c.type === 'toolCall'));
  const toolCallHistory = estimateJsonTokens(historicalToolCalls);
  addTokenSection(sections, 'tool_call_history', toolCallHistory.tokens, toolCallHistory.chars);

  splitCurrentUserMessage(currentUser, sections);

  const ordered = orderSections(sections);
  const totalTokens = ordered.reduce((sum, section) => sum + section.tokens, 0);
  const totalChars = ordered.reduce((sum, section) => sum + section.chars, 0);
  return { totalTokens, totalChars, method: 'estimated', sections: ordered };
}
