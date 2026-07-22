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
import { Errors } from 'typebox/value';
import { SemanticModelV2 as SemanticModelV2Schema } from '@/lib/validation/atlas-schemas';
import type { SemanticModelV2, SemanticReference, SemanticReferenceM2M, SemanticSource } from '@/lib/types/semantic';
import type { DatabaseWithSchema, ViewDef } from '@/lib/types';
import { exposedColumns } from '@/lib/types/views';
import { semanticAlias } from './compile';
import { lexMetricSql } from './metric-sql';

// The lexer lives in ./metric-sql (shared with the compiler); re-exported here
// so validation consumers keep one import site.
export { lexMetricSql } from './metric-sql';
export type { MetricRef, MetricLexResult } from './metric-sql';

/** What the validator resolves sources against. */
export interface SemanticModelCtx {
  /** Exposed schema (own whitelist applied) — tables + columns with types. */
  fullSchema: DatabaseWithSchema[];
  /** Views visible in this context tree (inherited fullViews + own version's). */
  views: ViewDef[];
  /** Names of OTHER semantic models visible in the tree (excluding this one). */
  otherModelNames?: string[];
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
 * Exposed column names of the model's PRIMARY source, in schema order.
 * Used by the tier-3 probe for the zero-dimension GROUP BY (§2.5 probe shape).
 */
export function primaryFieldNames(model: SemanticModelV2, ctx: SemanticModelCtx): string[] {
  const res = resolveSource(model.primary, model, ctx, 'primary');
  return res.fields ? [...res.fields.keys()] : [];
}

/**
 * Tier-1 validation. Returns human-readable issues (empty = valid), matching
 * the `SemanticCompileError.issues` style used by the semantic compiler.
 */
export function validateSemanticModel(
  model: SemanticModelV2,
  ctx: SemanticModelCtx,
): string[] {
  // SHAPE GATE FIRST. The Static type makes `primary`/`dimensions`/`metrics`
  // and each reference's `relationship`/`on`/`through` required, so the rules
  // below dereference them unguarded — but nothing enforces that at RUNTIME on
  // agent- or JSON-authored models. Without this, a model missing a field
  // throws a raw TypeError that escapes as an HTTP 500 with no issue list,
  // which is exactly the failure an LLM writing this JSON hits first and the
  // one it cannot self-correct from. Bail out here: the shape must be right
  // before any semantic rule can be evaluated.
  const shapeIssues = [...Errors(SemanticModelV2Schema, model)]
    .slice(0, 10)
    .map((e) => `${e.instancePath || '(root)'} ${e.message}`);
  if (shapeIssues.length > 0) {
    return [`malformed model — fix its shape first: ${shapeIssues.join('; ')}`];
  }

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
      const pkCols = (model.primaryKey ?? []).join(',');
      const onCols = ref.through.primaryOn.map((o) => o.primaryColumn).join(',');
      if (ref.through.primaryOn.length === 0 || ref.through.referencedOn.length === 0) {
        issues.push(`${at}: many_to_many needs at least one join-column pair on each side of the bridge`);
      } else if (pkCols && onCols !== pkCols) {
        // The compiler keys the bridge join off `through.primaryOn`, so a
        // mismatch here would silently compile at a grain that is NOT the
        // declared primaryKey — the "two m2m references can never disagree"
        // guarantee (§2.3) has to be enforced, not just declared.
        issues.push(`${at}: through.primaryOn joins the primary on "${onCols}", but the model's primaryKey is "${pkCols}" — the m2m grain must be the declared primary key (same columns, same order)`);
      }
    }
  }

  // ── primaryKey ────────────────────────────────────────────────────────────
  const hasM2M = references.some(isM2M);
  const primaryFields = fieldsByKey.get('primary');
  if (hasM2M) {
    if (!model.primaryKey || model.primaryKey.length === 0) {
      issues.push('primaryKey is required when any reference is many_to_many — it is the grain the m2m compilation preserves');
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

  // ── Temporal flags (type check skipped when the column type is unknown) ───
  for (const d of model.dimensions) {
    if (!d.temporal) continue;
    const fields = fieldsByKey.get(d.source === 'primary' ? 'primary' : d.source);
    const type = fields?.get(d.column) ?? '';
    if (type && !TEMPORAL_TYPE.test(type)) {
      issues.push(`dimension "${d.name}": flagged temporal but column "${d.column}" has type "${type}" — the time axis must be a date/time column`);
    }
  }

  // ── Name-slug namespace across dimensions + metrics ───────────────────────
  const slugOwners = new Map<string, string>();
  for (const entry of [
    ...model.dimensions.map((d) => d.name),
    ...model.metrics.map((m) => m.name),
  ]) {
    const slug = semanticAlias(entry);
    const owner = slugOwners.get(slug);
    if (owner !== undefined && owner !== entry) {
      issues.push(`"${entry}" collides with "${owner}" — dimension/metric names must be unique within a model (compared case-insensitively as slugs)`);
    } else if (owner !== undefined) {
      issues.push(`"${entry}" is declared more than once — dimension/metric names must be unique within a model`);
    }
    slugOwners.set(slug, entry);
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  const aggMetricNames = new Set(model.metrics.filter((m) => m.type === 'aggregation').map((m) => m.name));
  // Bare-ref candidates come from every resolved source (incl. m2m: pointing
  // at tags.weight in the error is more useful than pretending it's unknown).
  const knownFields = new Map<string, Set<string>>();
  for (const [key, fields] of fieldsByKey) knownFields.set(key, new Set(fields.keys()));

  for (const metric of model.metrics) {
    const at = `metric "${metric.name}"`;
    if (metric.type === 'aggregation') {
      if (metric.column != null && primaryFields && !primaryFields.has(metric.column)) {
        issues.push(`${at}: column "${metric.column}" is not an exposed field of the primary — aggregation metrics aggregate the primary only; use a SQL metric for reference columns`);
      }
      continue;
    }
    if (metric.type === 'ratio') {
      for (const refName of [metric.numerator, metric.denominator]) {
        if (!aggMetricNames.has(refName)) {
          issues.push(`${at}: "${refName}" is not a declared aggregation metric`);
        }
      }
      continue;
    }
    // SQL metric — lexer-backed rules.
    const lex = lexMetricSql(metric.sql, knownFields);
    // Paren balance FIRST: the engine's error for this (tier 3) points into
    // the compiled probe SQL — lines and aliases the author never wrote. A
    // tier-1 message about THEIR text is the one they can act on.
    if (lex.unclosedParens > 0) {
      issues.push(`${at}: unbalanced parentheses — ${lex.unclosedParens} "(" ${lex.unclosedParens === 1 ? 'is' : 'are'} never closed`);
    }
    if (lex.extraCloseParens > 0) {
      issues.push(`${at}: unbalanced parentheses — ${lex.extraCloseParens} ")" ${lex.extraCloseParens === 1 ? 'has' : 'have'} no matching "("`);
    }
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
      issues.push(b.candidates.length > 0
        ? `${at}: "${b.ident}" is ambiguous — qualify it as ${b.candidates.join(' or ')}`
        : `${at}: "${b.ident}" is not qualified — write primary.${b.ident} or <alias>.${b.ident}`);
    }
  }

  return issues;
}
