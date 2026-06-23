/**
 * QuestionV2 ⇄ jsx adapter (File Architecture v2).
 *
 * A QuestionV2 file stores its query/connection/viz as a static-JSX string in the
 * file's `jsx` field:
 *
 *   <Question connection="github" viz={{"type":"bar","xCols":["a"]}}>{`SELECT … WHERE a < 5`}</Question>
 *
 * The SQL lives in a template-literal child so `<`, `>`, `{` stay raw (the reliability
 * win); only backtick and `${` are escaped. This adapter converts between that string
 * and the effective `{ query, connection_name, vizSettings }` the existing question
 * render/query path consumes.
 */
import { parseJsx } from '@/lib/jsx';
import type { JsxElement } from '@/lib/jsx';
import type { VizSettings } from '@/lib/types';

export interface QuestionV2Parsed {
  query: string;
  connection_name: string;
  vizSettings?: VizSettings;
}

export type ParseQuestionResult =
  | { ok: true; value: QuestionV2Parsed }
  | { ok: false; error: string };

export function parseQuestionJsx(jsx: string): ParseQuestionResult {
  const parsed = parseJsx(jsx);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const el = parsed.nodes.find((n): n is JsxElement => n.type === 'element' && n.tag === 'Question');
  if (!el) return { ok: false, error: 'QuestionV2 jsx must contain a <Question> element' };

  const connAttr = el.attributes.find((a) => a.name === 'connection');
  const connection_name = connAttr?.value.static && typeof connAttr.value.json === 'string' ? connAttr.value.json : '';

  const vizAttr = el.attributes.find((a) => a.name === 'viz');
  const vizSettings =
    vizAttr?.value.static && typeof vizAttr.value.json === 'object' && vizAttr.value.json !== null && !Array.isArray(vizAttr.value.json)
      ? (vizAttr.value.json as unknown as VizSettings)
      : undefined;

  // Prefer a static-string expression child (template/string literal); else join text.
  const exprChild = el.children.find((c) => c.type === 'expression' && c.value.static && typeof c.value.json === 'string');
  const query =
    exprChild && exprChild.type === 'expression' && exprChild.value.static
      ? String(exprChild.value.json)
      : el.children.filter((c) => c.type === 'text').map((c) => (c.type === 'text' ? c.value : '')).join('').trim();

  return { ok: true, value: { query, connection_name, vizSettings } };
}

export function buildQuestionJsx(p: QuestionV2Parsed): string {
  const conn = ` connection=${JSON.stringify(p.connection_name)}`;
  const viz = p.vizSettings ? ` viz={${JSON.stringify(p.vizSettings)}}` : '';
  // Escape only what would break the template literal — `\`, backtick, and `${`.
  const sql = p.query.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `<Question${conn}${viz}>{\`${sql}\`}</Question>`;
}
