/**
 * Metric markdown transformers for the docs Lexical editor.
 *
 * A metric is INLINE — it flows inside a sentence like a mention chip — and is
 * stored as a single-line directive (newlines in the SQL are escaped as \n):
 *
 *     We track :metric{name="Monthly Revenue" sql="SELECT sum(amount)\nFROM orders"} weekly.
 *
 * `name` is required, `description` and `sql` optional. The older FENCED block
 * form (`:::metric{...}` … `:::`) is still imported for backward compatibility
 * — it lands wrapped in a paragraph and re-exports in the inline form.
 */

import type { MultilineElementTransformer, TextMatchTransformer } from '@lexical/markdown';
import { $createParagraphNode, type LexicalNode, type TextNode } from 'lexical';
import { MetricNode, $createMetricNode, $isMetricNode, type MetricData } from './MetricNode';

const METRIC_START_REGEX = /^:::metric\{(.*)\}\s*$/;
const METRIC_END_REGEX = /^:::\s*$/;

// Attr body: anything except a closing brace, unless it's inside a quoted
// string (which may contain braces and escaped quotes).
const INLINE_ATTRS = '((?:[^}"]|"(?:[^"\\\\]|\\\\.)*")*)';
const METRIC_INLINE_IMPORT_REGEX = new RegExp(`:metric\\{${INLINE_ATTRS}\\}`);
const METRIC_INLINE_REGEX = new RegExp(`:metric\\{${INLINE_ATTRS}\\}$`);

function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function unescapeAttr(value: string): string {
  return value.replace(/\\(n|"|\\)/g, (_, c: string) => (c === 'n' ? '\n' : c));
}

/** Parse `key="value" key2="value2"` (with escaped quotes/newlines) into a map. */
function parseAttrs(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)="((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    out[match[1]] = unescapeAttr(match[2]);
  }
  return out;
}

function attrsToMetricData(attrs: Record<string, string>, sqlOverride?: string): MetricData {
  return {
    name: attrs.name || 'Untitled metric',
    description: attrs.description?.trim() || undefined,
    sql: (sqlOverride ?? attrs.sql)?.trim() || undefined,
  };
}

function serializeMetric(node: MetricNode): string {
  const { name, description, sql } = node.getMetricData();
  let attrs = `name="${escapeAttr(name || '')}"`;
  if (description?.trim()) attrs += ` description="${escapeAttr(description)}"`;
  if (sql?.trim()) attrs += ` sql="${escapeAttr(sql.trim())}"`;
  return `:metric{${attrs}}`;
}

/** The one true (inline) metric form — owns both export and import. */
export const METRIC_INLINE: TextMatchTransformer = {
  dependencies: [MetricNode],
  export: (node: LexicalNode) => {
    if (!$isMetricNode(node)) return null;
    return serializeMetric(node);
  },
  importRegExp: METRIC_INLINE_IMPORT_REGEX,
  regExp: METRIC_INLINE_REGEX,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    textNode.replace($createMetricNode(attrsToMetricData(parseAttrs(match[1]))));
  },
  trigger: '}',
  type: 'text-match',
};

/**
 * LEGACY IMPORT ONLY — the old fenced block form. The (inline) node is wrapped
 * in a paragraph; export always goes through METRIC_INLINE.
 */
export const METRIC: MultilineElementTransformer = {
  dependencies: [MetricNode],
  export: () => null,
  regExpStart: METRIC_START_REGEX,
  regExpEnd: METRIC_END_REGEX,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex, startMatch }) => {
    const sqlLines: string[] = [];
    let endIndex = startLineIndex;
    let foundEnd = false;
    for (let i = startLineIndex + 1; i < lines.length; i++) {
      if (METRIC_END_REGEX.test(lines[i])) { endIndex = i; foundEnd = true; break; }
      sqlLines.push(lines[i]);
    }
    // Without a closing fence it isn't a metric block — let other transformers try.
    if (!foundEnd) return null;

    const paragraph = $createParagraphNode();
    paragraph.append($createMetricNode(attrsToMetricData(parseAttrs(startMatch[1]), sqlLines.join('\n'))));
    rootNode.append(paragraph);
    return [true, endIndex];
  },
  replace: (rootNode, _children, startMatch, _endMatch, linesInBetween) => {
    const paragraph = $createParagraphNode();
    paragraph.append($createMetricNode(attrsToMetricData(parseAttrs(startMatch[1]), (linesInBetween || []).join('\n'))));
    rootNode.append(paragraph);
  },
  type: 'multiline-element',
};
