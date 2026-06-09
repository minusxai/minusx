/**
 * Report markdown transformers.
 *
 * The report is stored as plain markdown so the AI agent can author and edit it
 * directly. Charts are embedded with a custom directive:
 *
 *     :::chart{id=5}
 *
 * which round-trips to/from a QuestionNode (a live chart embed). This is kept
 * separate from the shared ALL_TRANSFORMERS because only the report registers
 * the QuestionNode — text blocks must not try to parse chart directives.
 */

import { type ElementTransformer, type Transformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { ALL_TRANSFORMERS } from './markdown-transformers';
import { QuestionNode, $createQuestionNode, $isQuestionNode } from './QuestionNode';

const CHART: ElementTransformer = {
  dependencies: [QuestionNode],
  export: (node: LexicalNode) => {
    if ($isQuestionNode(node)) {
      return `:::chart{id=${node.getQuestionId()}}`;
    }
    return null;
  },
  regExp: /^:::chart\{id=(\d+)\}\s*$/,
  replace: (parentNode: ElementNode, _children, match) => {
    const id = parseInt(match[1], 10);
    if (Number.isNaN(id)) return;
    parentNode.replace($createQuestionNode(id));
  },
  type: 'element',
};

export const REPORT_TRANSFORMERS: Transformer[] = [CHART, ...ALL_TRANSFORMERS];
