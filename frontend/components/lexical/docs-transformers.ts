/**
 * Composition root for the docs Lexical editor's markdown transformers + nodes.
 *
 * Builds on the generic ALL_TRANSFORMERS (headings, lists, tables, images, ...)
 * and layers the docs-specific custom blocks: @ mentions and :::metric directives.
 * Order matters — custom transformers come before the defaults so they win for
 * overlapping syntax.
 */

import type { Transformer } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import type { Klass, LexicalNode } from 'lexical';

import { ImageNode } from './ImageNode';
import { MetricNode } from './MetricNode';
import { MentionNode } from './MentionNode';
import { ALL_TRANSFORMERS } from './markdown-transformers';
import { MENTION } from './mention-transformer';
import { METRIC, METRIC_INLINE } from './metric-transformer';

/** All transformers for the docs editor + viewer. METRIC is legacy import of
 * the fenced block form; METRIC_INLINE owns the current inline round-trip. */
export const DOCS_TRANSFORMERS: Transformer[] = [METRIC, METRIC_INLINE, MENTION, ...ALL_TRANSFORMERS];

/** All node classes the docs editor + viewer must register. */
export const DOCS_NODES: Array<Klass<LexicalNode>> = [
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
  ImageNode,
  MentionNode,
  MetricNode,
];
