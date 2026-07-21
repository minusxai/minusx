/**
 * Tier-1 static validation for authored semantic models (Semantic_Model_v2.md §2.5).
 *
 * Pure and synchronous: name/alias/namespace rules, source resolution against
 * the exposed schema, and the qualified-ref lexer for metric SQL. No DB or
 * connector access — engine-level checking is tier 3's job (the LIMIT 0 probe).
 *
 * The lexer is deliberately NOT the polyglot parser: the parser returns opaque
 * `raw` select columns for any compound aggregate (verified), so a
 * comment/string-aware token scan over qualified identifiers is the mechanism.
 */
import type { SemanticModelV2, SemanticReference, SemanticReferenceM2M, SemanticSource } from '@/lib/types/semantic';
import type { DatabaseWithSchema, ViewDef } from '@/lib/types';
import { exposedColumns } from '@/lib/types/views';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { semanticAlias } from './compile';

/** What the validator resolves sources against. */
export interface SemanticModelCtx {
  /** Exposed schema (own whitelist applied) — tables + columns with types. */
  fullSchema: DatabaseWithSchema[];
  /** Views visible in this context tree (inherited fullViews + own version's). */
  views: ViewDef[];
  /** Names of OTHER semantic models visible in the tree (excluding this one). */
  otherModelNames?: string[];
}

/** A qualified `alias.column` reference found in metric SQL. */
export interface MetricRef {
  alias: string;
  column: string;
}

/** Lexer output for one metric SQL expression. */
export interface MetricLexResult {
  /** Qualified `alias.column` refs (outside strings/comments). */
  refs: MetricRef[];
  /** Bare identifiers (unqualified) with the exposed fields they could mean. */
  bare: Array<{ ident: string; candidates: string[] }>;
  /** True when the SQL contains a quoted (`"…"` / backtick) identifier. */
  quoted: boolean;
}

// Common SQL keywords — never treated as bare column refs. Deliberately broad:
// a keyword wrongly in this list only silences a bare-ref hint (tier 3 still
// catches real mistakes); a keyword missing from it produces a false positive.
const SQL_KEYWORDS = immutableSet([
  'select', 'from', 'where', 'case', 'when', 'then', 'else', 'end', 'and', 'or',
  'not', 'null', 'is', 'in', 'like', 'ilike', 'between', 'as', 'distinct',
  'cast', 'interval', 'true', 'false', 'over', 'partition', 'by', 'order',
  'group', 'having', 'limit', 'asc', 'desc', 'on', 'join', 'left', 'right',
  'inner', 'outer', 'exists', 'all', 'any', 'nulls', 'first', 'last',
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

/**
 * Comment/string-aware scan of a metric SQL expression.
 * `knownFields` maps a source key ('primary' or a reference alias) to its
 * exposed column names — used only to flag ambiguous bare identifiers.
 */
export function lexMetricSql(
  sql: string,
  knownFields: Map<string, Set<string>>,
): MetricLexResult {
  const refs: MetricRef[] = [];
  const bare: Array<{ ident: string; candidates: string[] }> = [];
  let quoted = false;

  // Token scan: identifiers + the structural chars we care about ('.', '(').
  type Tok = { kind: 'ident' | 'dot' | 'lparen' | 'other'; text: string };
  const toks: Tok[] = [];

  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    // Single-quoted string ('' escapes)
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      toks.push({ kind: 'other', text: "'str'" });
      continue;
    }
    // Line comment
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // Quoted identifiers — rejected by policy, just flag their presence.
    if (c === '"' || c === '`') {
      quoted = true;
      const close = c;
      i++;
      while (i < n && sql[i] !== close) i++;
      i++;
      toks.push({ kind: 'other', text: 'quoted-ident' });
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(sql[j])) j++;
      toks.push({ kind: 'ident', text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '.') { toks.push({ kind: 'dot', text: '.' }); i++; continue; }
    if (c === '(') { toks.push({ kind: 'lparen', text: '(' }); i++; continue; }
    if (!/\s/.test(c)) toks.push({ kind: 'other', text: c });
    i++;
  }

  const seenBare = new Set<string>();
  for (let t = 0; t < toks.length; t++) {
    const tok = toks[t];
    if (tok.kind !== 'ident') continue;
    const prev = toks[t - 1];
    const next = toks[t + 1];
    if (next?.kind === 'dot' && toks[t + 2]?.kind === 'ident') {
      // Qualified ref: alias '.' column — consume all three.
      refs.push({ alias: tok.text, column: toks[t + 2].text });
      t += 2;
      continue;
    }
    if (prev?.kind === 'dot') continue;              // column side already consumed / stray
    if (next?.kind === 'lparen') continue;           // function name
    if (SQL_KEYWORDS.has(tok.text.toLowerCase())) continue;
    // Bare identifier — flag only when it matches an exposed field somewhere.
    const candidates: string[] = [];
    for (const [source, cols] of knownFields) {
      if (cols.has(tok.text)) candidates.push(`${source}.${tok.text}`);
    }
    if (candidates.length > 0 && !seenBare.has(tok.text)) {
      seenBare.add(tok.text);
      bare.push({ ident: tok.text, candidates: candidates.sort() });
    }
  }

  return { refs, bare, quoted };
}

const TEMPORAL_TYPE = /date|time/i;

type FieldMap = Map<string, string>; // column name → type ('' when unknown)

/** Look a table up in the exposed schema of ONE connection. */
function findTableFields(
  fullSchema: DatabaseWithSchema[],
  connection: string,
  schema: string | null | undefined,
  table: string,
): FieldMap | null {
  const db = fullSchema.find((d) => d.databaseName === connection);
  if (!db) return null;
  for (const s of db.schemas) {
    if (schema && s.schema !== schema) continue;
    const t = s.tables.find((tt) => tt.table === table);
    if (t) return new Map(t.columns.map((c) => [c.name, c.type ?? '']));
  }
  return null;
}

/** Resolve a SemanticSource to its exposed fields, or an error string. */
function resolveSource(
  source: SemanticSource,
  model: SemanticModelV2,
  ctx: SemanticModelCtx,
  at: string,
): { fields?: FieldMap; error?: string } {
  if (source.kind === 'table') {
    const fields = findTableFields(ctx.fullSchema, model.connection, source.schema, source.table);
    if (!fields) {
      return { error: `${at}: "${source.table}" is not an exposed table on connection "${model.connection}"` };
    }
    return { fields };
  }
  const view = ctx.views.find((v) => v.name === source.view);
  if (!view) {
    return { error: `${at}: data model (view) "${source.view}" does not exist in this context` };
  }
  if (view.connection !== model.connection) {
    return { error: `${at}: data model "${source.view}" lives on connection "${view.connection}", not the model's connection "${model.connection}" — cross-connection joins cannot compile` };
  }
  return { fields: new Map(exposedColumns(view).map((c) => [c.name, c.type ?? ''])) };
}

const isM2M = (r: SemanticReference): r is SemanticReferenceM2M => r.relationship === 'many_to_many';

/**
 * Tier-1 validation. Returns human-readable issues (empty = valid), matching
 * the `SemanticCompileError.issues` style used by the semantic compiler.
 */
export function validateSemanticModel(
  model: SemanticModelV2,
  ctx: SemanticModelCtx,
): string[] {
  const issues: string[] = [];

  // ── Model name ────────────────────────────────────────────────────────────
  const name = model.name?.trim() ?? '';
  if (!name) issues.push('model name must not be empty');
  const nameLower = name.toLowerCase();
  const viewClash = ctx.views.find((v) => v.name.toLowerCase() === nameLower);
  if (name && viewClash) {
    issues.push(`model name "${name}" is already used by a data model (view) — semantic models and views share one namespace`);
  }
  if (name && (ctx.otherModelNames ?? []).some((m) => m.toLowerCase() === nameLower)) {
    issues.push(`model name "${name}" is already used by another semantic model`);
  }

  // ── References: aliases + sources ─────────────────────────────────────────
  const references = model.references ?? [];
  const aliasSeen = new Set<string>();
  const fieldsByKey = new Map<string, FieldMap>(); // 'primary' + resolved aliases
  const m2mAliases = new Set<string>();
  const toOneAliases = new Set<string>();

  const primaryRes = resolveSource(model.primary, model, ctx, 'primary');
  if (primaryRes.error) issues.push(primaryRes.error);
  if (primaryRes.fields) fieldsByKey.set('primary', primaryRes.fields);

  for (const ref of references) {
    const alias = ref.alias;
    const at = `reference "${alias}"`;
    if (alias === 'primary' || alias === '_grain' || alias === '_views' || alias === '_probe' || alias.startsWith('_m2m_')) {
      issues.push(`${at}: alias "${alias}" is reserved — pick another alias`);
    }
    const lower = alias.toLowerCase();
    if (aliasSeen.has(lower)) {
      issues.push(`${at}: alias "${alias}" is declared more than once — reference aliases must be unique`);
    }
    aliasSeen.add(lower);
    (isM2M(ref) ? m2mAliases : toOneAliases).add(alias);

    const res = resolveSource(ref.source, model, ctx, at);
    if (res.error) issues.push(res.error);
    if (res.fields) fieldsByKey.set(alias, res.fields);

    if (isM2M(ref)) {
      const bridgeRes = resolveSource(ref.through.source, model, ctx, `${at} (bridge)`);
      if (bridgeRes.error) issues.push(bridgeRes.error);
      if (ref.through.primaryOn.length !== 1 || ref.through.referencedOn.length !== 1) {
        issues.push(`${at}: many_to_many join keys must be a single column each — composite-key m2m is not supported; add a surrogate key or a concatenated key column in a data model`);
      }
    }
  }

  // ── primaryKey ────────────────────────────────────────────────────────────
  const hasM2M = references.some(isM2M);
  const primaryFields = fieldsByKey.get('primary');
  if (hasM2M) {
    if (!model.primaryKey || model.primaryKey.length === 0) {
      issues.push('primaryKey is required when any reference is many_to_many — it is the grain the m2m compilation preserves');
    } else if (model.primaryKey.length !== 1) {
      issues.push('primaryKey must be a single column when any reference is many_to_many — composite-key m2m is not supported');
    }
  }
  for (const pk of model.primaryKey ?? []) {
    if (primaryFields && !primaryFields.has(pk)) {
      issues.push(`primaryKey column "${pk}" is not an exposed field of the primary`);
    }
  }

  // ── Dimensions ────────────────────────────────────────────────────────────
  for (const d of model.dimensions) {
    const at = `dimension "${d.name}"`;
    if (d.source !== 'primary' && !aliasSeen.has(d.source.toLowerCase())) {
      issues.push(`${at}: source "${d.source}" is not "primary" or a declared reference alias`);
      continue;
    }
    const fields = fieldsByKey.get(d.source === 'primary' ? 'primary' : d.source);
    if (fields && !fields.has(d.column)) {
      issues.push(`${at}: column "${d.column}" is not an exposed field of source "${d.source}"`);
    }
  }

  // ── Measures (primary-column-only by construction) ────────────────────────
  for (const m of model.measures) {
    if (m.column != null && primaryFields && !primaryFields.has(m.column)) {
      issues.push(`measure "${m.name}": column "${m.column}" is not an exposed field of the primary — measures aggregate the primary only; use a SQL metric for reference columns`);
    }
  }

  // ── Name-slug namespace across dimensions + measures + metrics ────────────
  const slugOwners = new Map<string, string>();
  for (const entry of [
    ...model.dimensions.map((d) => d.name),
    ...model.measures.map((m) => m.name),
    ...(model.metrics ?? []).map((m) => m.name),
  ]) {
    const slug = semanticAlias(entry);
    const owner = slugOwners.get(slug);
    if (owner !== undefined && owner !== entry) {
      issues.push(`"${entry}" collides with "${owner}" — dimension/measure/metric names must be unique within a model (compared case-insensitively as slugs)`);
    } else if (owner !== undefined) {
      issues.push(`"${entry}" is declared more than once — dimension/measure/metric names must be unique within a model`);
    }
    slugOwners.set(slug, entry);
  }

  // ── timeDimension (primary-only; type check skipped when unprofiled) ──────
  if (model.timeDimension) {
    const colName = model.timeDimension.column;
    if (primaryFields && !primaryFields.has(colName)) {
      issues.push(`timeDimension column "${colName}" is not an exposed field of the primary`);
    } else if (primaryFields) {
      const type = primaryFields.get(colName) ?? '';
      if (type && !TEMPORAL_TYPE.test(type)) {
        issues.push(`timeDimension column "${colName}" is not temporal (type "${type}") — the time axis must be a date/time column of the primary`);
      }
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  const measureNames = new Set(model.measures.map((m) => m.name));
  // Bare-ref candidates come from every resolved source (incl. m2m: pointing
  // at tags.weight in the error is more useful than pretending it's unknown).
  const knownFields = new Map<string, Set<string>>();
  for (const [key, fields] of fieldsByKey) knownFields.set(key, new Set(fields.keys()));

  for (const metric of model.metrics ?? []) {
    const at = `metric "${metric.name}"`;
    if (metric.type === 'ratio') {
      for (const refName of [metric.numerator, metric.denominator]) {
        if (!measureNames.has(refName)) {
          issues.push(`${at}: "${refName}" is not a declared measure`);
        }
      }
      continue;
    }
    // SQL metric — lexer-backed rules.
    const lex = lexMetricSql(metric.sql, knownFields);
    if (lex.quoted) {
      issues.push(`${at}: quoted identifiers aren't supported in metric SQL — a column that needs quoting must be renamed via a data model before it can be referenced`);
    }
    for (const ref of lex.refs) {
      if (ref.alias === 'primary' || toOneAliases.has(ref.alias)) {
        const fields = fieldsByKey.get(ref.alias);
        if (fields && !fields.has(ref.column)) {
          issues.push(`${at}: "${ref.alias}.${ref.column}" — column "${ref.column}" is not an exposed field of "${ref.alias}"`);
        }
      } else if (m2mAliases.has(ref.alias)) {
        issues.push(`${at}: metric SQL cannot reference m2m reference "${ref.alias}" — aggregating across a many-to-many side fans out; pre-aggregate it in a data model instead`);
      } else {
        issues.push(`${at}: "${ref.alias}" is not "primary" or a declared reference alias`);
      }
    }
    for (const b of lex.bare) {
      issues.push(`${at}: "${b.ident}" is ambiguous — qualify it as ${b.candidates.join(' or ')}`);
    }
  }

  return issues;
}
