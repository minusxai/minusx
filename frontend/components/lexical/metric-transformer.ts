/**
 * Metric markdown transformer for the docs Lexical editor.
 *
 * A metric is stored as a fenced directive block so it stays readable in raw
 * markdown and is easy for the AI agent to author/read:
 *
 *     :::metric{name="Monthly Revenue" description="Revenue per month"}
 *     SELECT date_trunc('month', created_at) AS month, sum(amount) AS revenue
 *     FROM orders GROUP BY 1
 *     :::
 *
 * `name` is required, `description` optional, and the body (SQL) optional.
 */

import type { MultilineElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { MetricNode, $createMetricNode, $isMetricNode } from './MetricNode';

const METRIC_START_REGEX = /^:::metric\{(.*)\}\s*$/;
const METRIC_END_REGEX = /^:::\s*$/;

function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function unescapeAttr(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** Parse `key="value" key2="value2"` (with escaped quotes) into a map. */
function parseAttrs(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)="((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    out[match[1]] = unescapeAttr(match[2]);
  }
  return out;
}

function serializeMetric(node: MetricNode): string {
  const { name, description, sql } = node.getMetricData();
  let attrs = `name="${escapeAttr(name || '')}"`;
  if (description?.trim()) attrs += ` description="${escapeAttr(description)}"`;
  const header = `:::metric{${attrs}}`;
  const body = sql?.trim() ? `\n${sql.trim()}` : '';
  return `${header}${body}\n:::`;
}

export const METRIC: MultilineElementTransformer = {
  dependencies: [MetricNode],
  export: (node: LexicalNode) => {
    if (!$isMetricNode(node)) return null;
    return serializeMetric(node);
  },
  regExpStart: METRIC_START_REGEX,
  regExpEnd: METRIC_END_REGEX,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex, startMatch }) => {
    const attrs = parseAttrs(startMatch[1]);
    const sqlLines: string[] = [];
    let endIndex = startLineIndex;
    let foundEnd = false;
    for (let i = startLineIndex + 1; i < lines.length; i++) {
      if (METRIC_END_REGEX.test(lines[i])) { endIndex = i; foundEnd = true; break; }
      sqlLines.push(lines[i]);
    }
    // Without a closing fence it isn't a metric block — let other transformers try.
    if (!foundEnd) return null;

    rootNode.append($createMetricNode({
      name: attrs.name || 'Untitled metric',
      description: attrs.description?.trim() || undefined,
      sql: sqlLines.join('\n').trim() || undefined,
    }));
    return [true, endIndex];
  },
  replace: (rootNode: ElementNode, _children, startMatch, _endMatch, linesInBetween) => {
    const attrs = parseAttrs(startMatch[1]);
    rootNode.append($createMetricNode({
      name: attrs.name || 'Untitled metric',
      description: attrs.description?.trim() || undefined,
      sql: (linesInBetween || []).join('\n').trim() || undefined,
    }));
  },
  type: 'multiline-element',
};
