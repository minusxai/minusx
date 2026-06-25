import type { Context, ImageContent, Message, TextContent } from '@/orchestrator/llm';

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

const APPROX_CHARS_PER_TOKEN = 4;
const IMAGE_TOKEN_ESTIMATE = 1_000;

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN));
}

function estimateJsonTokens(value: unknown): { tokens: number; chars: number } {
  const text = value == null ? '' : JSON.stringify(value);
  return { tokens: estimateTextTokens(text), chars: text.length };
}

function addSection(sections: ContextSizeSection[], key: string, label: string, text: string): void {
  if (!text) return;
  sections.push({ key, label, tokens: estimateTextTokens(text), chars: text.length });
}

function addTokenSection(sections: ContextSizeSection[], key: string, label: string, tokens: number, chars = 0): void {
  if (tokens <= 0) return;
  sections.push({ key, label, tokens, chars });
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
  if (!message) return;
  const text = contentToText(message.content);
  const images = countImages(message.content);
  addTokenSection(sections, 'image_attachments', 'Images', images * IMAGE_TOKEN_ESTIMATE);

  const appState = extractTagged(text, 'AppState').join('\n');
  addSection(sections, 'app_state', 'App state', appState);

  const attachments = extractTagged(text, 'Attachment').join('\n');
  addSection(sections, 'text_attachments', 'Text attachments', attachments);

  const withoutContextBlocks = stripTagged(stripTagged(text, 'AppState'), 'Attachment');
  const parts = withoutContextBlocks.split(/\n/).filter(Boolean);
  const nextUserMessage = parts.at(-1) ?? '';
  const wrapper = parts.slice(0, -1).join('\n');
  addSection(sections, 'current_turn_wrapper', 'Current turn wrapper', wrapper);
  addSection(sections, 'next_user_message', 'Next user message', nextUserMessage);
}

export function estimateContextSize(context: Context): ContextSizeEstimate {
  const sections: ContextSizeSection[] = [];

  addSection(sections, 'system_prompt', 'System prompt', context.systemPrompt ?? '');

  const tools = estimateJsonTokens(context.tools ?? []);
  addTokenSection(sections, 'tool_definitions', 'Tool definitions', tools.tokens, tools.chars);

  const messages = context.messages ?? [];
  const currentUser = messages.at(-1);
  const history = messages.slice(0, -1);

  const historyText = history.map((m) => {
    const role = 'role' in m ? m.role : 'message';
    return `${role}\n${contentToText(m.content)}`;
  }).join('\n\n');
  addSection(sections, 'conversation_history', 'Conversation history', historyText);

  const historicalToolCalls = history
    .filter((m) => 'role' in m && m.role === 'assistant' && Array.isArray(m.content))
    .flatMap((m) => (m.content as Array<{ type?: string }>).filter((c) => c.type === 'toolCall'));
  const toolCallHistory = estimateJsonTokens(historicalToolCalls);
  addTokenSection(sections, 'tool_call_history', 'Tool call history', toolCallHistory.tokens, toolCallHistory.chars);

  splitCurrentUserMessage(currentUser, sections);

  const totalTokens = sections.reduce((sum, section) => sum + section.tokens, 0);
  const totalChars = sections.reduce((sum, section) => sum + section.chars, 0);
  return { totalTokens, totalChars, method: 'estimated', sections };
}
