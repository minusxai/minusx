/**
 * Metric markdown transformer for the docs Lexical editor.
 *
 * A metric is INLINE — it flows inside a sentence like a mention chip — and is
 * stored as `:metric` followed by flat JSON, the same grammar as mention chips
 * (`@{json}`), so every doc chip is "a token + flat JSON":
 *
 *     We track :metric{"name":"Monthly Revenue","sql":"SELECT sum(amount)\nFROM orders"} weekly.
 *
 * `name` is required; `description` and `sql` optional. JSON.stringify/parse
 * handle all escaping (quotes, newlines in SQL), so multi-line SQL stays on
 * one markdown line with no bespoke escaping scheme.
 */

import type { TextMatchTransformer } from '@lexical/markdown';
import type { LexicalNode, TextNode } from 'lexical';
import { MetricNode, $createMetricNode, $isMetricNode, type MetricData } from './MetricNode';

// The JSON body: no raw braces outside quoted strings (MetricData is flat),
// while quoted strings may contain braces and escaped quotes — so this stops
// exactly at the object's closing brace even for SQL like `WHERE y = '{}'`.
const JSON_BODY = '(\\{(?:[^{}"]|"(?:[^"\\\\]|\\\\.)*")*\\})';
const METRIC_IMPORT_REGEX = new RegExp(`:metric${JSON_BODY}`);
const METRIC_REGEX = new RegExp(`:metric${JSON_BODY}$`);

function serializeMetric(node: MetricNode): string {
  const { name, description, sql } = node.getMetricData();
  const data: MetricData = { name: name || '' };
  if (description?.trim()) data.description = description;
  if (sql?.trim()) data.sql = sql.trim();
  return `:metric${JSON.stringify(data)}`;
}

export const METRIC: TextMatchTransformer = {
  dependencies: [MetricNode],
  export: (node: LexicalNode) => {
    if (!$isMetricNode(node)) return null;
    return serializeMetric(node);
  },
  importRegExp: METRIC_IMPORT_REGEX,
  regExp: METRIC_REGEX,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    try {
      const parsed = JSON.parse(match[1]) as Partial<MetricData>;
      textNode.replace($createMetricNode({
        name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Untitled metric',
        description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description : undefined,
        sql: typeof parsed.sql === 'string' && parsed.sql.trim() ? parsed.sql : undefined,
      }));
    } catch {
      // Malformed JSON — leave the text as-is rather than throw.
    }
  },
  trigger: '}',
  type: 'text-match',
};
