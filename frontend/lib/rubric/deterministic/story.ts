import { parseJsx } from '@/lib/jsx';
import type { JsxNode } from '@/lib/jsx';
import type { StoryContent } from '@/lib/types';
import type { RubricFinding } from '../types';
import { distinctHexColors, findFactualNumbers, finding, hasFontFamily, isBlank } from './shared';

const MIN_COLORS = 2;
const MAX_COLORS = 10;

interface StoryScan {
  embeds: number;        // <Question> / <Number> count
  headings: number;      // <h1>/<h2> count
  css: string;           // concatenated <style> content
  proseNumbers: string[]; // factual figures typed into prose (outside embeds/style)
}

function walk(nodes: JsxNode[], acc: StoryScan, insideStyle: boolean): void {
  for (const n of nodes) {
    if (n.type === 'text') {
      if (!insideStyle) acc.proseNumbers.push(...findFactualNumbers(n.value));
      continue;
    }
    if (n.type === 'expression') {
      if (insideStyle && n.value.static && typeof n.value.json === 'string') acc.css += n.value.json;
      continue;
    }
    // element
    if (n.tag === 'Question' || n.tag === 'Number') { acc.embeds++; continue; }
    if (n.tag === 'Param') continue;
    if (/^h[12]$/i.test(n.tag)) acc.headings++;
    walk(n.children, acc, insideStyle || n.tag.toLowerCase() === 'style');
  }
}

/** Deterministic health findings for a story. Pure function of content. */
export function scoreStory(content: StoryContent): RubricFinding[] {
  const out: RubricFinding[] = [];

  // no-lead (clarity)
  if (isBlank(content.description)) {
    out.push(finding('story.no-lead', 'clarity', 'info', 'No lead',
      'The story has no description/lead.',
      'State the single lead finding (with its number) in the description.'));
  }

  const acc: StoryScan = { embeds: 0, headings: 0, css: '', proseNumbers: [] };
  const parsed = parseJsx(content.story ?? '');
  if (parsed.ok) walk(parsed.nodes, acc, false);

  // no-evidence (correctness)
  if (acc.embeds === 0) {
    out.push(finding('story.no-evidence', 'correctness', 'error', 'No live evidence',
      'The story body has no <Question> or <Number> embeds.',
      'Back the narrative with at least one live chart (<Question>) or number (<Number>).'));
  }

  // no-headline (clarity)
  if (acc.headings === 0) {
    out.push(finding('story.no-headline', 'clarity', 'warn', 'No headline',
      'The story body has no <h1>/<h2> heading.',
      'Add a headline that states the finding (a claim with a number), not a topic.'));
  }

  // typed-number (correctness)
  if (acc.proseNumbers.length > 0) {
    const first = acc.proseNumbers[0];
    out.push(finding('story.typed-number', 'correctness', 'warn', 'Hardcoded number in prose',
      `A factual figure "${first}" is typed into prose instead of a live embed.`,
      `Replace the typed figure "${first}" with a live <Number> embed so it can't go stale or be wrong.`));
  }

  // design tokens (craft)
  const colors = distinctHexColors(acc.css);
  const fonts = hasFontFamily(acc.css);
  if (colors.length < MIN_COLORS || !fonts) {
    out.push(finding('story.no-design-tokens', 'craft', 'info', 'Thin design tokens',
      `The style block defines ${colors.length} color(s)${fonts ? '' : ' and no font-family'}.`,
      'Define a deliberate palette (4–6 named hex colors) and ~3 font roles before styling.'));
  } else if (colors.length > MAX_COLORS) {
    out.push(finding('story.too-many-colors', 'craft', 'info', 'Too many colors',
      `The style block defines ${colors.length} distinct colors.`,
      'Reduce to a disciplined 4–6 color palette with one protagonist accent.'));
  }

  return out;
}
