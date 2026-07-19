/**
 * Message → component breakdown (one level, per bar) for the /debug viz.
 *
 * User/input messages split on the projection's markup tags (`<AppState>`,
 * `<file_markup …>`, `<query_data …>`, `<Attachment …>`); whatever text
 * remains is the user's own words (`UserText`). Images adjacent to (i.e.
 * immediately following) the AppState block are the app-state screenshot;
 * any other image is a user upload.
 *
 * Assistant messages split into Thinking / Text and ONE component PER tool
 * call; tool results produce ONE component PER result — sizes stay separate
 * by design (that's the point of the viz).
 */
import type { AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage } from '@/orchestrator/llm';
import { estimateImageTokens, estimateTextTokens } from './approx';
import type { BarComponent, ComponentType, InspectableContent } from './types';

function textComponent(type: ComponentType, text: string, extra: Partial<BarComponent> = {}): BarComponent {
  return {
    type,
    tokens: estimateTextTokens(text),
    imageTokens: 0,
    chars: text.length,
    imageCount: 0,
    content: [{ kind: 'text', text }],
    ...extra,
  };
}

function imageComponent(type: ComponentType, images: ImageContent[]): BarComponent {
  const tokens = images.reduce((s, img) => s + estimateImageTokens(img), 0);
  const content: InspectableContent[] = images.map((img) => ({
    kind: 'image',
    src: img.url ?? `data:${img.mimeType ?? 'image/png'};base64,${img.data ?? ''}`,
  }));
  return { type, tokens, imageTokens: tokens, chars: 0, imageCount: images.length, content };
}

const TAG_COMPONENTS: Array<{ tag: string; type: ComponentType }> = [
  { tag: 'AppState', type: 'AppStateText' },
  { tag: 'file_markup', type: 'FileMarkup' },
  { tag: 'query_data', type: 'QueryData' },
  { tag: 'Attachment', type: 'Other' },
];

function tagRe(tag: string): RegExp {
  return new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
}

/** Split one user-turn's content blocks into components. */
export function splitUserContent(content: Message['content']): BarComponent[] {
  const blocks: (TextContent | ImageContent)[] =
    typeof content === 'string' ? [{ type: 'text', text: content }] : (content as (TextContent | ImageContent)[]);

  const components: BarComponent[] = [];
  const tagged = new Map<ComponentType, string[]>();
  const userTexts: string[] = [];
  const appStateImages: ImageContent[] = [];
  const userImages: ImageContent[] = [];

  let prevTextHadAppState = false;
  for (const block of blocks) {
    if (block.type === 'image') {
      (prevTextHadAppState ? appStateImages : userImages).push(block);
      continue;
    }
    let remaining = block.text;
    for (const { tag, type } of TAG_COMPONENTS) {
      const matches = Array.from(remaining.matchAll(tagRe(tag)), (m) => m[1] ?? '');
      if (matches.length > 0) {
        tagged.set(type, [...(tagged.get(type) ?? []), ...matches]);
        remaining = remaining.replace(tagRe(tag), '');
      }
    }
    const rest = remaining.split('\n').filter((line) => line.trim().length > 0).join('\n');
    if (rest) userTexts.push(rest);
    prevTextHadAppState = /<\/AppState>/.test(block.text);
  }

  for (const { type } of TAG_COMPONENTS) {
    const texts = tagged.get(type);
    if (texts?.length) components.push(textComponent(type, texts.join('\n')));
  }
  if (appStateImages.length > 0) components.push(imageComponent('AppStateImage', appStateImages));
  if (userTexts.length > 0) components.push(textComponent('UserText', userTexts.join('\n')));
  if (userImages.length > 0) components.push(imageComponent('UserImages', userImages));
  return components;
}

/** Split an assistant message into Thinking / Text / per-tool-call components. */
export function splitAssistantContent(msg: AssistantMessage): BarComponent[] {
  const components: BarComponent[] = [];
  const thinking = msg.content
    .filter((c): c is Extract<typeof c, { type: 'thinking' }> => c.type === 'thinking')
    .map((c) => c.thinking)
    .join('\n');
  if (thinking) components.push(textComponent('Thinking', thinking));

  const text = msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  if (text) components.push(textComponent('Text', text));

  for (const block of msg.content) {
    if (block.type !== 'toolCall') continue;
    const serialized = JSON.stringify({ name: block.name, arguments: block.arguments });
    components.push({
      ...textComponent('ToolCalls', serialized),
      toolName: block.name,
      toolCallId: block.id,
      content: [{ kind: 'json', value: { name: block.name, arguments: block.arguments } }],
    });
  }
  return components;
}

/** One component per tool result — each result's size stays visible. */
export function toolResultComponents(results: ToolResultMessage[]): BarComponent[] {
  return results.map((r) => {
    const text = r.content
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const images = r.content.filter((c): c is ImageContent => c.type === 'image');
    const imageTokens = images.reduce((s, img) => s + estimateImageTokens(img), 0);
    const content: InspectableContent[] = [
      ...(text ? [{ kind: 'text', text } as const] : []),
      ...images.map((img) => ({
        kind: 'image' as const,
        src: img.url ?? `data:${img.mimeType ?? 'image/png'};base64,${img.data ?? ''}`,
      })),
    ];
    return {
      type: 'ToolResult' as const,
      toolName: r.toolName,
      toolCallId: r.toolCallId,
      tokens: estimateTextTokens(text) + imageTokens,
      imageTokens,
      chars: text.length,
      imageCount: images.length,
      content,
    };
  });
}
