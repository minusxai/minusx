import { describe, it, expect } from 'vitest';
import { createHeadlessEditor } from '@lexical/headless';
import { $getRoot } from 'lexical';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { ALL_TRANSFORMERS } from '../markdown-transformers';

const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  LinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  HorizontalRuleNode,
];

/** Create a headless editor, load markdown, return the parsed node types. */
function parseMarkdown(markdown: string) {
  const editor = createHeadlessEditor({
    nodes: EDITOR_NODES,
    onError: (e) => { throw e; },
  });

  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS, root, true);
    },
    { discrete: true },
  );

  let nodeTypes: string[] = [];
  let nodeDetails: Array<{ type: string; text?: string }> = [];

  editor.getEditorState().read(() => {
    const root = $getRoot();
    const children = root.getChildren();
    nodeTypes = children.map((c) => c.getType());
    nodeDetails = children.map((c) => {
      const detail: { type: string; text?: string } = { type: c.getType() };
      if ('getTextContent' in c) {
        detail.text = (c as any).getTextContent().slice(0, 80);
      }
      return detail;
    });
  });

  return { editor, nodeTypes, nodeDetails };
}

/** Load markdown → export back to markdown string. */
function roundTrip(markdown: string): string {
  const { editor } = parseMarkdown(markdown);

  let result = '';
  editor.getEditorState().read(() => {
    result = $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true);
  });

  return result;
}

const SAMPLE_MARKDOWN = `# 📊 mxfood — Top Level Metrics Summary\n\n> hi\n\n---\n\n**mxfood is on a strong growth trajectory.** Monthly completed orders reached **39,882** in December 2025, up from just 312 in January 2024. Monthly revenue hit **$3.02M** in December 2025, reflecting consistent growth throughout the year. Monthly active users grew to **9,258**, with returning users far outnumbering new signups each week — a healthy sign of retention.\n\n\n**iOS is the dominant platform** (45% of Dec revenue), followed by Android (35%) and Web (20%). Revenue is well-distributed across zones, with Castro, Sunset, and Haight-Ashbury leading at \\~$265K each. **Main Course** is the top-grossing product category by a wide margin. Subscription adoption remains an opportunity — only **5.5% of users** are active subscribers as of December 2025.\n\n| Metric | Dec 2025 |\n|---|---|\n| Monthly Orders | 39,882 |\n| Monthly Revenue | $3.02M |\n| Monthly Active Users | 9,258 |\n| Subscriber Rate | 5.5% |\n| Top Platform | iOS (45%) |\n| Top Zone | Castro |`;

describe('markdown-transformers', () => {
  it('parses the full sample markdown into expected node types', () => {
    const { nodeTypes, nodeDetails } = parseMarkdown(SAMPLE_MARKDOWN);

    console.log('Parsed node types:', nodeTypes);
    console.log('Parsed node details:', JSON.stringify(nodeDetails, null, 2));

    // Should have a heading
    expect(nodeTypes).toContain('heading');
    // Should have at least one paragraph
    expect(nodeTypes).toContain('paragraph');
    // Should not be empty
    expect(nodeTypes.length).toBeGreaterThan(1);
  });

  it('parses horizontal rule correctly', () => {
    const { nodeTypes } = parseMarkdown('Some text\n\n---\n\nMore text');

    console.log('HR node types:', nodeTypes);
    expect(nodeTypes).toContain('horizontalrule');
  });

  it('parses a markdown table into a table node', () => {
    const md = '| Name | Value |\n|---|---|\n| A | 1 |\n| B | 2 |';
    const { nodeTypes, nodeDetails } = parseMarkdown(md);

    console.log('Table node types:', nodeTypes);
    console.log('Table details:', JSON.stringify(nodeDetails, null, 2));
    expect(nodeTypes).toContain('table');
  });

  it('parses blockquote correctly', () => {
    const { nodeTypes } = parseMarkdown('> hello world');

    console.log('Quote node types:', nodeTypes);
    expect(nodeTypes).toContain('quote');
  });

  it('round-trips horizontal rule', () => {
    const result = roundTrip('text before\n\n---\n\ntext after');
    console.log('HR round-trip:', JSON.stringify(result));
    expect(result).toContain('---');
  });

  it('round-trips a table', () => {
    const md = '| Name | Value |\n|---|---|\n| A | 1 |\n| B | 2 |';
    const result = roundTrip(md);
    console.log('Table round-trip:', JSON.stringify(result));
    expect(result).toContain('|');
    expect(result).toContain('Name');
  });
});
