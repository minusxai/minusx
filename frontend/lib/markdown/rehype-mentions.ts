import { splitMentions } from '@/lib/utils/mentions';

/**
 * Minimal hast node shape — we only touch `children`, `type`, and `value`.
 * (Avoids pulling in `@types/hast`/`unist-util-visit` for this small transform.)
 */
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Rehype plugin that turns `@{...json...}` mentions in text nodes into
 * `<span data-mention>` chip placeholders, so the `Markdown` component can
 * render them as mention chips inline (e.g. in the docs/context sidebar).
 *
 * Runs on the hast tree (after markdown parsing), so mentions render anywhere
 * markdown produces text — paragraphs, list items, headings, emphasis, etc.
 * The full `@{...}` string is stashed in `properties.mentionJson` for the
 * `span` component override to parse and for copy/paste round-tripping.
 */
export function rehypeMentions() {
  return (tree: HastNode) => {
    visit(tree);
  };
}

function visit(node: HastNode): void {
  if (!node.children || node.children.length === 0) return;

  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value && child.value.includes('@{')) {
      const segments = splitMentions(child.value);
      if (segments.some((s) => s.type === 'mention')) {
        for (const seg of segments) {
          if (seg.type === 'text') {
            if (seg.value) next.push({ type: 'text', value: seg.value });
          } else {
            next.push({
              type: 'element',
              tagName: 'span',
              properties: { mentionJson: seg.raw },
              children: [{ type: 'text', value: seg.raw }],
            });
          }
        }
        continue;
      }
    }
    visit(child);
    next.push(child);
  }
  node.children = next;
}
