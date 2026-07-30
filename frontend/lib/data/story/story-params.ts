/**
 * Story params (File Architecture v2). A story declares `<Param>` components in its jsx that
 * form a shared param context; every embedded `<Question/>` binds to it by name.
 *
 * Like `<Question/>`, a `<Param/>` round-trips through `content.story` as a `<div data-param-*>`
 * PLACEHOLDER (so it renders where the agent placed it, AgentHtml mounts a ParameterInput
 * there). The declarations are DERIVED from those placeholders — never a separate stored field;
 * submitted/default values live in `StoryContent.parameterValues`.
 *
 * Pure (client + server safe). The static-JSX engine validates `<Param>` (it's in the registry).
 */
import type { ParameterType, QuestionParameter } from '@/lib/validation/atlas-schemas';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import { normalizeInlineQuery } from './story-question';
import { setStaticJsxAttr, updateJsxElementAtPath } from './jsx-edit';
import { escAttr, escTemplate, unescAttr, styleAttr, serializeJsonAttr, parseJsonAttr } from './html-attr';

/** Autocomplete / import source: a column of an embedded question. */
export interface StoryQuestionParamSource {
  questionId: number;
  column: string;
}

/** Autocomplete source backed by story-local SQL (the first result column supplies options). */
export interface StorySqlParamSource {
  query: string;
  connection: string;
}

export type StoryParamSource = StoryQuestionParamSource | StorySqlParamSource;

export const isStoryQuestionParamSource = (source: StoryParamSource): source is StoryQuestionParamSource =>
  'questionId' in source;

export const isStorySqlParamSource = (source: StoryParamSource): source is StorySqlParamSource =>
  'query' in source;

/** A declared story param (derived from a `<Param>` element). */
export interface StoryParam {
  /** Stable SQL binding name (`:name`). */
  name: string;
  /** Optional reader-facing text; defaults to a humanized form of `name`. */
  label?: string;
  type: ParameterType; // 'text' | 'number' | 'date'
  nullable: boolean;
  /** `<Param id={N} column="c">` — autocomplete from / import the def of question N's column. */
  source?: StoryParamSource;
  /** Agent-supplied CSS applied to the filter INPUT (`<Param style={{…}}>`), so the control can
   *  match the story design — literal CSS, not theme tokens (overrides the default legible look). */
  style?: Record<string, string | number>;
  /** Agent-supplied CSS applied to the param LABEL (`<Param labelStyle={{…}}>`). */
  labelStyle?: Record<string, string | number>;
  /** Control widget override. `'slider'` (number params) renders a range slider instead of an
   *  input; default is a typed input / autocomplete. */
  widget?: 'slider';
  /** Slider bounds (only used when widget==='slider'). */
  min?: number;
  max?: number;
  step?: number;
}

const TYPES = ['text', 'number', 'date'];
/** Normalise an author-written type to the canonical ParameterType (`string`→`text`, …). */
export function normalizeParamType(t: unknown): ParameterType {
  const s = String(t ?? 'text').toLowerCase();
  if (s === 'string' || s === 'str') return 'text';
  if (s === 'int' || s === 'integer' || s === 'float' || s === 'num') return 'number';
  return (TYPES.includes(s) ? s : 'text') as ParameterType;
}

/** Build a StoryParam from a `<Param>` element's parsed jsx attributes (name→value map). */
export function paramFromJsxAttrs(attrs: Record<string, unknown>): StoryParam | null {
  const name = typeof attrs.name === 'string' ? attrs.name : '';
  if (!name) return null;
  const param: StoryParam = { name, type: normalizeParamType(attrs.type), nullable: attrs.nullable !== false };
  if (typeof attrs.label === 'string' && attrs.label.trim()) param.label = attrs.label;
  if (typeof attrs.id === 'number') {
    param.source = { questionId: attrs.id, column: typeof attrs.column === 'string' ? attrs.column : name };
  } else if (typeof attrs.query === 'string' && attrs.query) {
    param.source = {
      query: normalizeInlineQuery(attrs.query),
      connection: typeof attrs.connection === 'string' ? attrs.connection : '',
    };
  }
  const style = styleAttr(attrs.style);
  if (style) param.style = style;
  const labelStyle = styleAttr(attrs.labelStyle);
  if (labelStyle) param.labelStyle = labelStyle;
  if (attrs.widget === 'slider') param.widget = 'slider';
  if (typeof attrs.min === 'number') param.min = attrs.min;
  if (typeof attrs.max === 'number') param.max = attrs.max;
  if (typeof attrs.step === 'number') param.step = attrs.step;
  return param;
}

/** StoryParam → the `<div data-param-*>` placeholder stored inside `content.story` HTML. */
export function paramToPlaceholder(p: StoryParam): string {
  const a = [
    `data-param-name="${escAttr(p.name)}"`,
    `data-param-type="${p.type}"`,
    `data-param-nullable="${p.nullable}"`,
  ];
  if (p.label) a.push(`data-param-label="${escAttr(p.label)}"`);
  if (p.source && isStoryQuestionParamSource(p.source)) {
    a.push(`data-param-source-id="${p.source.questionId}"`, `data-param-source-col="${escAttr(p.source.column)}"`);
  } else if (p.source) {
    a.push(`data-param-source-sql="${serializeJsonAttr(p.source)}"`);
  }
  if (p.style) a.push(`data-param-style="${serializeJsonAttr(p.style)}"`);
  if (p.labelStyle) a.push(`data-param-labelstyle="${serializeJsonAttr(p.labelStyle)}"`);
  if (p.widget) a.push(`data-param-widget="${p.widget}"`);
  if (p.min != null) a.push(`data-param-min="${p.min}"`);
  if (p.max != null) a.push(`data-param-max="${p.max}"`);
  if (p.step != null) a.push(`data-param-step="${p.step}"`);
  return `<div ${a.join(' ')}></div>`;
}

/** StoryParam → the `<Param/>` jsx the agent reads/edits (part of the param ⇄ jsx codec).
 *  String attrs are entity-escaped (escAttr) so a quote in a name/column can't break the parse. */
export function paramToJsx(p: StoryParam): string {
  const a = [`name="${escAttr(p.name)}"`, `type="${p.type}"`, `nullable={${p.nullable}}`];
  if (p.label) a.push(`label="${escAttr(p.label)}"`);
  if (p.source && isStoryQuestionParamSource(p.source)) {
    a.push(`id={${p.source.questionId}}`);
    if (p.source.column !== p.name) a.push(`column="${escAttr(p.source.column)}"`);
  } else if (p.source) {
    a.push(`query={\`${escTemplate(p.source.query)}\`}`);
    a.push(`connection="${escAttr(p.source.connection)}"`);
  }
  if (p.style) a.push(`style={${JSON.stringify(p.style)}}`);
  if (p.labelStyle) a.push(`labelStyle={${JSON.stringify(p.labelStyle)}}`);
  if (p.widget) a.push(`widget="${p.widget}"`);
  if (p.min != null) a.push(`min={${p.min}}`);
  if (p.max != null) a.push(`max={${p.max}}`);
  if (p.step != null) a.push(`step={${p.step}}`);
  return `<Param ${a.join(' ')} />`;
}

const PARAM_DIV_RE = /<div\s+([^>]*?data-param-name="[^"]*"[^>]*?)>\s*<\/div>/g;

function paramFromPlaceholderInner(inner: string): StoryParam | null {
  const a: Record<string, string> = {};
  for (const m of inner.matchAll(/data-param-([a-z-]+)="([^"]*)"/g)) a[m[1]] = unescAttr(m[2]);
  if (!a.name) return null;
  const p: StoryParam = { name: a.name, type: normalizeParamType(a.type), nullable: a.nullable !== 'false' };
  if (a.label) p.label = a.label;
  if (a['source-id']) {
    p.source = { questionId: Number(a['source-id']), column: a['source-col'] ?? a.name };
  } else {
    const rawSql = inner.match(/data-param-source-sql="([^"]*)"/)?.[1];
    const sql = parseJsonAttr<StorySqlParamSource>(rawSql, (v) =>
      !!v && typeof v.query === 'string' && typeof v.connection === 'string');
    if (sql?.query) p.source = { query: normalizeInlineQuery(sql.query), connection: sql.connection };
  }
  const style = parseStyleJson(a.style);
  if (style) p.style = style;
  const labelStyle = parseStyleJson(a.labelstyle);
  if (labelStyle) p.labelStyle = labelStyle;
  if (a.widget === 'slider') p.widget = 'slider';
  if (a.min != null && a.min !== '') p.min = Number(a.min);
  if (a.max != null && a.max !== '') p.max = Number(a.max);
  if (a.step != null && a.step !== '') p.step = Number(a.step);
  return p;
}

/** Parse a stored style JSON string (already entity-decoded by unescAttr / getAttribute). */
function parseStyleJson(v: string | null | undefined): Record<string, string | number> | undefined {
  if (!v) return undefined;
  try { return styleAttr(JSON.parse(v)); } catch { return undefined; }
}

/** Extract all declared params from legacy placeholders or a new-format JSX story body. */
export function extractStoryParams(html: string | null | undefined): StoryParam[] {
  const out: StoryParam[] = [];
  for (const m of (html ?? '').matchAll(PARAM_DIV_RE)) {
    const p = paramFromPlaceholderInner(m[1]);
    if (p) out.push(p);
  }
  // New-format stories store JSX verbatim, so there are no data-param placeholders to scan.
  // Parse their static <Param> nodes directly. Best-effort: malformed JSX contributes nothing;
  // the save validator reports the syntax error through its normal path.
  const parsed = parseJsx(html ?? '');
  if (parsed.ok) {
    const walk = (nodes: JsxNode[]): void => {
      for (const node of nodes) {
        if (node.type !== 'element') continue;
        if (node.isComponent && node.tag === 'Param') {
          const attrs: Record<string, unknown> = {};
          for (const attr of node.attributes) if (attr.value.static) attrs[attr.name] = attr.value.json;
          const p = paramFromJsxAttrs(attrs);
          if (p) out.push(p);
        }
        walk(node.children);
      }
    };
    walk(parsed.nodes);
  }
  return out;
}

/** Rewrite a story HTML's `<div data-param>` placeholders back to `<Param/>` jsx (for buildStoryJsx). */
export function placeholdersToParamJsx(html: string | null | undefined): string {
  return (html ?? '').replace(PARAM_DIV_RE, (whole, inner) => {
    const p = paramFromPlaceholderInner(inner);
    return p ? paramToJsx(p) : whole;
  });
}

/** Replace the inline SQL source on the `occurrence`-th legacy Param placeholder. */
export function updateParamQueryInHtml(html: string, occurrence: number, query: string): string {
  let seen = 0;
  return html.replace(PARAM_DIV_RE, (whole, inner) => {
    if (seen++ !== occurrence) return whole;
    const param = paramFromPlaceholderInner(inner);
    if (!param?.source || !isStorySqlParamSource(param.source)) return whole;
    return paramToPlaceholder({
      ...param,
      source: { ...param.source, query: normalizeInlineQuery(query) },
    });
  });
}

/** Replace the inline SQL source on the `<Param>` at `astPath` in a JSX-format story. */
export function updateParamQueryInJsx(source: string, astPath: string, query: string): string {
  return updateJsxElementAtPath(source, astPath, 'Param', (el) => {
    if (el.attributes.some((a) => a.name === 'id') || !el.attributes.some((a) => a.name === 'query')) return false;
    setStaticJsxAttr(el, 'query', normalizeInlineQuery(query));
  });
}

/** Read a StoryParam from a rendered placeholder element (AgentHtml has the DOM node). */
export function paramFromPlaceholderEl(el: { getAttribute(name: string): string | null }): StoryParam | null {
  const name = el.getAttribute('data-param-name');
  if (!name) return null;
  const p: StoryParam = { name, type: normalizeParamType(el.getAttribute('data-param-type')), nullable: el.getAttribute('data-param-nullable') !== 'false' };
  const label = el.getAttribute('data-param-label');
  if (label) p.label = label;
  const sid = el.getAttribute('data-param-source-id');
  if (sid) {
    p.source = { questionId: Number(sid), column: el.getAttribute('data-param-source-col') ?? name };
  } else {
    const sql = parseJsonAttr<StorySqlParamSource>(el.getAttribute('data-param-source-sql'), (v) =>
      !!v && typeof v.query === 'string' && typeof v.connection === 'string');
    if (sql?.query) p.source = { query: normalizeInlineQuery(sql.query), connection: sql.connection };
  }
  const style = parseStyleJson(el.getAttribute('data-param-style'));
  if (style) p.style = style;
  const labelStyle = parseStyleJson(el.getAttribute('data-param-labelstyle'));
  if (labelStyle) p.labelStyle = labelStyle;
  if (el.getAttribute('data-param-widget') === 'slider') p.widget = 'slider';
  const min = el.getAttribute('data-param-min');
  if (min != null && min !== '') p.min = Number(min);
  const max = el.getAttribute('data-param-max');
  if (max != null && max !== '') p.max = Number(max);
  const step = el.getAttribute('data-param-step');
  if (step != null && step !== '') p.step = Number(step);
  return p;
}

/** A declared story param → the QuestionParameter shape the embeds + ParameterInput consume. */
export function storyParamToQuestionParameter(p: StoryParam): QuestionParameter {
  return {
    name: p.name,
    type: p.type,
    label: p.label ?? null,
    source: p.source
      ? isStoryQuestionParamSource(p.source)
        ? { type: 'question', id: p.source.questionId, column: p.source.column }
        : { type: 'sql', query: p.source.query }
      : null,
  };
}

// ── Lint + import resolution ────────────────────────────────────────────────

/** An embedded question's identity + SQL + stored params (the param types live here, not in the SQL). */
export interface EmbeddedQuestion {
  /** saved question file id, or 0 for an inline (file-less) story question. */
  id: number;
  query: string;
  parameters?: QuestionParameter[];
  /** 1-based position among the story's inline questions (set only when id === 0), for lint messages. */
  inlineIndex?: number;
}

/** Human label for an embedded question in lint messages ("Question 5" or "Inline question #2"). */
function embeddedQuestionLabel(q: EmbeddedQuestion): string {
  return q.id > 0 ? `Question ${q.id}` : `Inline question #${q.inlineIndex ?? 1}`;
}

/**
 * Non-blocking lint: every `:param` an embedded question needs should have a matching
 * `<Param name=…>` declared (same name, compatible type). Returns advisory messages — the
 * edit is never blocked; the agent gets this as feedback and can add the missing declarations.
 * Param types come from each question's stored `parameters` (the SQL alone doesn't type them).
 */
export function lintStoryParams(declared: StoryParam[], questions: EmbeddedQuestion[]): string[] {
  const byName = new Map(declared.map((p) => [p.name, p]));
  const warnings: string[] = [];
  const used = new Set<string>();
  for (const q of questions) {
    const label = embeddedQuestionLabel(q);
    for (const needed of syncParametersWithSQL(q.query || '', q.parameters ?? [])) {
      used.add(needed.name);
      const decl = byName.get(needed.name);
      if (!decl) {
        warnings.push(`${label} uses :${needed.name} (${needed.type}) but no <Param name="${needed.name}"> is declared in the story.`);
      } else if (decl.type !== needed.type) {
        warnings.push(`${label} uses :${needed.name} as ${needed.type}, but <Param name="${needed.name}"> declares it as ${decl.type}.`);
      }
    }
  }
  for (const p of declared) {
    if (!used.has(p.name)) warnings.push(`<Param name="${p.name}"> is declared but no embedded question uses :${p.name}.`);
  }
  return warnings;
}

/**
 * Dashboard param lint: dashboards AUTO-derive params from their questions (merged by
 * name+type), so the only thing to flag is a TYPE CONFLICT — when two questions use the same
 * `:param` name with different types, auto-derive silently makes two separate filters. Returns
 * advisory messages; never blocks the edit.
 */
export function lintDashboardParams(questions: EmbeddedQuestion[]): string[] {
  const typesByName = new Map<string, Map<ParameterType, number[]>>();
  for (const q of questions) {
    for (const p of syncParametersWithSQL(q.query || '', q.parameters ?? [])) {
      if (!typesByName.has(p.name)) typesByName.set(p.name, new Map());
      const byType = typesByName.get(p.name)!;
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type)!.push(q.id);
    }
  }
  const warnings: string[] = [];
  for (const [name, byType] of typesByName) {
    if (byType.size > 1) {
      const desc = [...byType.entries()].map(([t, ids]) => `${t} (question${ids.length > 1 ? 's' : ''} ${ids.join(', ')})`).join(' vs ');
      warnings.push(`Dashboard param :${name} has conflicting types across questions: ${desc} — they won't share one filter.`);
    }
  }
  return warnings;
}

/**
 * Non-blocking lint: a `<Param id={N}>` imports its autocomplete/type from question N. Warn when
 * that referenced question doesn't exist, or isn't a question. `resolve` maps an id to the file's
 * type (or `undefined` if not found) — typically `(id) => selectFile(state, id)?.type`.
 */
export function lintStoryParamSources(declared: StoryParam[], resolve: (id: number) => string | undefined): string[] {
  const warnings: string[] = [];
  for (const p of declared) {
    if (!p.source) continue;
    if (isStorySqlParamSource(p.source)) {
      if (!p.source.connection) {
        warnings.push(`<Param name="${p.name}"> has an inline SQL source but no connection.`);
      }
      continue;
    }
    const t = resolve(p.source.questionId);
    if (t === undefined) {
      warnings.push(`<Param name="${p.name}"> imports from question #${p.source.questionId}, which doesn't exist.`);
    } else if (t !== 'question') {
      warnings.push(`<Param name="${p.name}"> imports from #${p.source.questionId}, which is a ${t}, not a question.`);
    }
  }
  return warnings;
}
