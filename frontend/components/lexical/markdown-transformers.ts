/**
 * Custom markdown transformers for Lexical that augment the default TRANSFORMERS.
 *
 * The default TRANSFORMERS from @lexical/markdown are missing:
 * - Horizontal rules (---)
 * - Tables (| col | col |)
 * - Checklists (- [x] item)
 *
 * This module provides those and exports a complete ALL_TRANSFORMERS array.
 */

import {
  TRANSFORMERS,
  CHECK_LIST,
  type ElementTransformer,
  type MultilineElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from '@lexical/markdown';

import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import { ImageNode, $createImageNode, $isImageNode } from './ImageNode';
import type { TextNode } from 'lexical';
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNode,
  $createTableRowNode,
  $createTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode,
  TableCellHeaderStates,
} from '@lexical/table';

import type { ElementNode, LexicalNode } from 'lexical';
import { $createParagraphNode, $createTextNode } from 'lexical';

// --- Horizontal Rule Transformer ---

const HORIZONTAL_RULE: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node: LexicalNode) => {
    if (node.getType() === 'horizontalrule') {
      return '---';
    }
    return null;
  },
  regExp: /^(?:---|\*\*\*|___)\s*$/,
  replace: (parentNode: ElementNode) => {
    const node = new HorizontalRuleNode();
    parentNode.replace(node);
  },
  type: 'element',
};

// --- Table helpers ---

const TABLE_ROW_REGEX = /^\|(.+)\|\s*$/;
const TABLE_SEPARATOR_REGEX = /^\|[\s\-:|]+\|\s*$/;

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

function buildTableNode(lines: string[]): TableNode | null {
  // Filter out separator rows and empty lines
  const dataLines = lines.filter(
    (line) => line.trim() !== '' && !TABLE_SEPARATOR_REGEX.test(line.trim())
  );

  if (dataLines.length === 0) return null;

  const tableNode = $createTableNode();

  dataLines.forEach((line, rowIndex) => {
    const cellTexts = parseTableRow(line);
    const isHeader = rowIndex === 0;
    const rowNode = $createTableRowNode();

    cellTexts.forEach((text) => {
      const cellNode = $createTableCellNode(
        isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS
      );
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(text));
      cellNode.append(paragraph);
      rowNode.append(cellNode);
    });

    tableNode.append(rowNode);
  });

  return tableNode;
}

// --- Table Transformer ---

const TABLE: MultilineElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node: LexicalNode, traverseChildren: (node: ElementNode) => string) => {
    if (!$isTableNode(node)) return null;

    const rows = node.getChildren();
    if (rows.length === 0) return null;

    const output: string[] = [];
    let isFirstRow = true;

    for (const row of rows) {
      if (!$isTableRowNode(row)) continue;

      const cells = row.getChildren();
      const cellTexts = cells.map((cell) => {
        if (!$isTableCellNode(cell)) return '';
        return traverseChildren(cell).replace(/\n/g, ' ').trim();
      });

      output.push(`| ${cellTexts.join(' | ')} |`);

      // Add separator after header row only
      if (isFirstRow) {
        const separator = cellTexts.map(() => '---').join(' | ');
        output.push(`| ${separator} |`);
        isFirstRow = false;
      }
    }

    return output.join('\n');
  },
  regExpStart: TABLE_ROW_REGEX,
  regExpEnd: {
    optional: true,
    regExp: TABLE_ROW_REGEX,
  },
  // Use handleImportAfterStartMatch to consume ALL consecutive table rows at once,
  // rather than letting the default behavior match one row at a time.
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex, startMatch }) => {
    const allTableLines: string[] = [startMatch[0]];

    // Consume all consecutive table rows (data rows + separator rows)
    let lastIndex = startLineIndex;
    for (let i = startLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (TABLE_ROW_REGEX.test(line) || TABLE_SEPARATOR_REGEX.test(line)) {
        allTableLines.push(line);
        lastIndex = i;
      } else {
        break;
      }
    }

    const tableNode = buildTableNode(allTableLines);
    if (!tableNode) return null;

    rootNode.append(tableNode);
    return [true, lastIndex];
  },
  replace: (
    rootNode: ElementNode,
    _children: LexicalNode[] | null,
    startMatch: string[],
    _endMatch: string[] | null,
    linesInBetween: string[] | null,
  ) => {
    // Fallback for markdown shortcuts (typing in editor). handleImportAfterStartMatch
    // handles the import path; this covers the shortcut/typing path.
    const allLines: string[] = [startMatch[0]];
    if (linesInBetween) {
      allLines.push(...linesInBetween);
    }

    const tableNode = buildTableNode(allLines);
    if (!tableNode) return;

    rootNode.append(tableNode);
  },
  type: 'multiline-element',
};

// --- Image Transformer ---
//
// Round-trips markdown images `![alt](src)` to/from the custom ImageNode. This
// MUST be ordered before the default LINK transformer (inside TRANSFORMERS):
// LINK matches `[text](url)` and would otherwise greedily claim the `[alt](src)`
// tail of an image, dropping the leading `!`.

const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node: LexicalNode) => {
    if (!$isImageNode(node)) return null;
    return `![${node.getAltText()}](${node.getSrc()})`;
  },
  importRegExp: /!\[([^[]*)\]\(([^()\s]+)\)/,
  regExp: /!\[([^[]*)\]\(([^()\s]+)\)$/,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    const [, altText, src] = match;
    const imageNode = $createImageNode({ altText, src });
    textNode.replace(imageNode);
  },
  trigger: ')',
  type: 'text-match',
};

// --- Export combined transformers ---

export const ALL_TRANSFORMERS: Transformer[] = [
  HORIZONTAL_RULE,
  TABLE,
  IMAGE,
  CHECK_LIST,
  ...TRANSFORMERS,
];
