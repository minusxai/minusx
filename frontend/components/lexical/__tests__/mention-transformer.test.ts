import { describe, it, expect } from 'vitest';
import { createHeadlessEditor } from '@lexical/headless';
import { $getRoot } from 'lexical';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $isMentionNode } from '@/components/chat/lexical/MentionNode';
import { DOCS_TRANSFORMERS, DOCS_NODES } from '../docs-transformers';

function makeEditor() {
  return createHeadlessEditor({ nodes: DOCS_NODES, onError: (e) => { throw e; } });
}

/** Parse markdown and collect every descendant node (mentions nest in paragraphs). */
function parse(markdown: string) {
  const editor = makeEditor();
  editor.update(
    () => { const root = $getRoot(); root.clear(); $convertFromMarkdownString(markdown, DOCS_TRANSFORMERS, root, true); },
    { discrete: true },
  );
  const all: Array<{ type: string; mentionData?: unknown }> = [];
  editor.getEditorState().read(() => {
    const collect = (node: any) => {
      all.push({ type: node.getType(), mentionData: $isMentionNode(node) ? node.__mentionData : undefined });
      if (typeof node.getChildren === 'function') node.getChildren().forEach(collect);
    };
    $getRoot().getChildren().forEach(collect);
  });
  return all;
}

function roundTrip(markdown: string) {
  const editor = makeEditor();
  editor.update(
    () => { const root = $getRoot(); root.clear(); $convertFromMarkdownString(markdown, DOCS_TRANSFORMERS, root, true); },
    { discrete: true },
  );
  let out = '';
  editor.getEditorState().read(() => { out = $convertToMarkdownString(DOCS_TRANSFORMERS, undefined, true); });
  return out;
}

describe('mention-transformer', () => {
  const TABLE_MENTION = '@{"type":"table","name":"orders","schema":"public","id":42}';
  const QUESTION_MENTION = '@{"type":"question","name":"Revenue Report","id":7}';

  it('imports a table mention into a MentionNode preserving its data', () => {
    const nodes = parse(`Revenue comes from ${TABLE_MENTION} mostly.`);
    const mention = nodes.find((n) => n.type === 'mention');
    expect(mention).toBeDefined();
    expect(mention?.mentionData).toMatchObject({ type: 'table', name: 'orders', schema: 'public', id: 42 });
  });

  it('round-trips a table mention back to the exact @{json} format', () => {
    const result = roundTrip(`See ${TABLE_MENTION} here.`);
    expect(result).toContain(TABLE_MENTION);
  });

  it('round-trips a question mention', () => {
    const result = roundTrip(`Based on ${QUESTION_MENTION}.`);
    expect(result).toContain(QUESTION_MENTION);
  });

  it('round-trips a column mention (type + table + schema)', () => {
    const COLUMN_MENTION = '@{"type":"column","name":"amount","schema":"public","table":"orders"}';
    const nodes = parse(`Revenue uses ${COLUMN_MENTION}.`);
    const mention = nodes.find((n) => n.type === 'mention');
    expect(mention?.mentionData).toMatchObject({ type: 'column', name: 'amount', table: 'orders', schema: 'public' });
    expect(roundTrip(`Revenue uses ${COLUMN_MENTION}.`)).toContain(COLUMN_MENTION);
  });

  it('leaves surrounding markdown formatting intact alongside a mention', () => {
    const result = roundTrip(`## Heading\n\n**bold** and ${TABLE_MENTION}`);
    expect(result).toContain('## Heading');
    expect(result).toContain('**bold**');
    expect(result).toContain(TABLE_MENTION);
  });
});
