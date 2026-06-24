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
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import { escAttr, unescAttr } from './html-attr';

/** Autocomplete / import source: a column of an embedded question. */
export interface StoryParamSource {
  questionId: number;
  column: string;
}

/** A declared story param (derived from a `<Param>` element). */
export interface StoryParam {
  name: string;
  type: ParameterType; // 'text' | 'number' | 'date'
  nullable: boolean;
  /** `<Param id={N} column="c">` — autocomplete from / import the def of question N's column. */
  source?: StoryParamSource;
  /** Agent-supplied CSS applied to the filter INPUT (`<Param style={{…}}>`), so the control can
   *  match the story design — literal CSS, not theme tokens (overrides the default legible look). */
  style?: Record<string, string | number>;
  /** Agent-supplied CSS applied to the param LABEL (`<Param labelStyle={{…}}>`). */
  labelStyle?: Record<string, string | number>;
}

/** Read a plain CSS object from a `<Param>` attribute value (object expressions parse to JSON). */
function styleAttr(v: unknown): Record<string, string | number> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string | number>) : undefined;
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
  if (typeof attrs.id === 'number') {
    param.source = { questionId: attrs.id, column: typeof attrs.column === 'string' ? attrs.column : name };
  }
  const style = styleAttr(attrs.style);
  if (style) param.style = style;
  const labelStyle = styleAttr(attrs.labelStyle);
  if (labelStyle) param.labelStyle = labelStyle;
  return param;
}

/** StoryParam → the `<div data-param-*>` placeholder stored inside `content.story` HTML. */
export function paramToPlaceholder(p: StoryParam): string {
  const a = [
    `data-param-name="${escAttr(p.name)}"`,
    `data-param-type="${p.type}"`,
    `data-param-nullable="${p.nullable}"`,
  ];
  if (p.source) a.push(`data-param-source-id="${p.source.questionId}"`, `data-param-source-col="${escAttr(p.source.column)}"`);
  if (p.style) a.push(`data-param-style="${escAttr(JSON.stringify(p.style))}"`);
  if (p.labelStyle) a.push(`data-param-labelstyle="${escAttr(JSON.stringify(p.labelStyle))}"`);
  return `<div ${a.join(' ')}></div>`;
}

/** StoryParam → the `<Param/>` jsx the agent reads/edits (part of the param ⇄ jsx codec). */
export function paramToJsx(p: StoryParam): string {
  const a = [`name="${p.name}"`, `type="${p.type}"`, `nullable={${p.nullable}}`];
  if (p.source) {
    a.push(`id={${p.source.questionId}}`);
    if (p.source.column !== p.name) a.push(`column="${p.source.column}"`);
  }
  if (p.style) a.push(`style={${JSON.stringify(p.style)}}`);
  if (p.labelStyle) a.push(`labelStyle={${JSON.stringify(p.labelStyle)}}`);
  return `<Param ${a.join(' ')} />`;
}

const PARAM_DIV_RE = /<div\s+([^>]*?data-param-name="[^"]*"[^>]*?)>\s*<\/div>/g;

function paramFromPlaceholderInner(inner: string): StoryParam | null {
  const a: Record<string, string> = {};
  for (const m of inner.matchAll(/data-param-([a-z-]+)="([^"]*)"/g)) a[m[1]] = unescAttr(m[2]);
  if (!a.name) return null;
  const p: StoryParam = { name: a.name, type: normalizeParamType(a.type), nullable: a.nullable !== 'false' };
  if (a['source-id']) p.source = { questionId: Number(a['source-id']), column: a['source-col'] ?? a.name };
  const style = parseStyleJson(a.style);
  if (style) p.style = style;
  const labelStyle = parseStyleJson(a.labelstyle);
  if (labelStyle) p.labelStyle = labelStyle;
  return p;
}

/** Parse a stored style JSON string (already entity-decoded by unescAttr / getAttribute). */
function parseStyleJson(v: string | null | undefined): Record<string, string | number> | undefined {
  if (!v) return undefined;
  try { return styleAttr(JSON.parse(v)); } catch { return undefined; }
}

/** Extract all declared params from a story's HTML (the `data-param` placeholders). */
export function extractStoryParams(html: string | null | undefined): StoryParam[] {
  const out: StoryParam[] = [];
  for (const m of (html ?? '').matchAll(PARAM_DIV_RE)) {
    const p = paramFromPlaceholderInner(m[1]);
    if (p) out.push(p);
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

/** Read a StoryParam from a rendered placeholder element (AgentHtml has the DOM node). */
export function paramFromPlaceholderEl(el: { getAttribute(name: string): string | null }): StoryParam | null {
  const name = el.getAttribute('data-param-name');
  if (!name) return null;
  const p: StoryParam = { name, type: normalizeParamType(el.getAttribute('data-param-type')), nullable: el.getAttribute('data-param-nullable') !== 'false' };
  const sid = el.getAttribute('data-param-source-id');
  if (sid) p.source = { questionId: Number(sid), column: el.getAttribute('data-param-source-col') ?? name };
  const style = parseStyleJson(el.getAttribute('data-param-style'));
  if (style) p.style = style;
  const labelStyle = parseStyleJson(el.getAttribute('data-param-labelstyle'));
  if (labelStyle) p.labelStyle = labelStyle;
  return p;
}

/** A declared story param → the QuestionParameter shape the embeds + ParameterInput consume. */
export function storyParamToQuestionParameter(p: StoryParam): QuestionParameter {
  return {
    name: p.name,
    type: p.type,
    label: null,
    source: p.source ? { type: 'question', id: p.source.questionId, column: p.source.column } : null,
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
    const t = resolve(p.source.questionId);
    if (t === undefined) {
      warnings.push(`<Param name="${p.name}"> imports from question #${p.source.questionId}, which doesn't exist.`);
    } else if (t !== 'question') {
      warnings.push(`<Param name="${p.name}"> imports from #${p.source.questionId}, which is a ${t}, not a question.`);
    }
  }
  return warnings;
}

