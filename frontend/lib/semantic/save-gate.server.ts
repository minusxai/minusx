/**
 * The context-save gate for authored semantic models (Semantic_Model_v2.md §2.5).
 *
 * Mirrors the views gate (lib/views/save-gate.server.ts): every context write —
 * editor UI, raw JSON, agent EditFile — passes through FilesAPI.saveFile, so
 * this is the only place that can honestly enforce validity. Three tiers:
 *
 *  1. STATIC  (validateSemanticModel) — pure rules; failures block.
 *  2. COMPILE (probe through the real compiler) — pure; failures block.
 *  3. DRY-RUN (`SELECT * FROM (…) AS _probe LIMIT 0` via runQuery) — the
 *     engine is the authority. Bad SQL blocks (fail closed); infrastructure
 *     failures fail OPEN: the save proceeds and the metric is stamped
 *     `verified: false`, staying in every subsequent probe set until it
 *     verifies. Probe scope is exactly three cases — metric-text-only (delta),
 *     metadata-only (nothing), anything else structural (all metrics) — and
 *     `verified` is SERVER-MANAGED: client-sent values are never trusted.
 */
import 'server-only';
import { computeSchemaFromWhitelist } from '@/lib/data/loaders/context-loader-utils';
import { resolveVersionWhitelist, getPublishedVersionForUser } from '@/lib/context/context-utils';
import { primaryFieldNames } from '@/lib/semantic/validate';
import { compileSemanticQuery } from '@/lib/semantic/compile';
// Tiers 1–2 + the probe spec live in the PURE module so the agent's EditFile path
// (browser-side — it cannot import this server-only file) runs the identical checks.
import { semanticModelIssues, probeSpec, sortedJson } from '@/lib/semantic/edit-check';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { resolveViewsInSql } from '@/lib/views/resolve';
import { runQuery } from '@/lib/connections/run-query';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { connectionTypeToDialect } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, ContextVersion, DatabaseWithSchema, SemanticModelV2, SemanticMetricV2, ViewDef } from '@/lib/types';
import type { QueryIR } from '@/lib/sql/ir-types';

export class SemanticModelSaveError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join('; '));
    this.name = 'SemanticModelSaveError';
    this.issues = issues;
  }
}

const PROBE_CONCURRENCY = 4;

// Infrastructure signatures — a down/slow warehouse must not block editing.
const INFRA_ERROR = /timed out|timeout|econnrefused|econnreset|enotfound|eai_again|epipe|fetch failed|socket|connection (refused|reset|closed|terminated|lost)|could not connect|unreachable|network/i;

/**
 * Validate every authored semantic model in the content (tiers 1–3) against
 * `existing` (the stored content — probe-scope diffing + sticky `verified`).
 * Returns the content with server-managed `verified` stamps applied; throws
 * SemanticModelSaveError when any model is invalid.
 */
export async function validateSemanticModelsGate(
  content: ContextContent,
  existing: ContextContent | undefined,
  contextPath: string,
  user: EffectiveUser,
): Promise<ContextContent> {
  const versions = content.versions ?? [];
  const hasModels = versions.some((v) => (v.semanticModels?.length ?? 0) > 0);
  if (!hasModels) return content;

  // Resolve what this context exposes + inherits. Same live-version choice as
  // the views gate; failures fall back to empty (source-resolution errors then
  // surface as "not exposed", which is the honest strict-save behavior).
  const live = versions.find((v) => v.version === getPublishedVersionForUser(content, user.userId)) ?? versions[0];
  let fullSchema: DatabaseWithSchema[] = [];
  let inheritedViews: ViewDef[] = content.fullViews ?? [];
  let inheritedModels: SemanticModelV2[] = content.fullSemanticModels ?? [];
  try {
    const computed = await computeSchemaFromWhitelist(resolveVersionWhitelist(live), contextPath, user);
    fullSchema = computed.fullSchema;
    inheritedViews = computed.fullViews;
    inheritedModels = computed.fullSemanticModels;
  } catch {
    // keep fallbacks
  }

  const problems: string[] = [];
  const nextVersions: ContextVersion[] = [];

  for (const version of versions) {
    const models = version.semanticModels ?? [];
    if (models.length === 0) { nextVersions.push(version); continue; }
    const views = [...inheritedViews, ...(version.views ?? [])];
    const oldVersion = (existing?.versions ?? []).find((v) => v.version === version.version);

    const nextModels: SemanticModelV2[] = [];
    for (const model of models) {
      const otherModelNames = [
        ...inheritedModels.map((m) => m.name),
        ...models.filter((m) => m !== model).map((m) => m.name),
      ];
      const ctx = { fullSchema, views, otherModelNames };
      const issues = semanticModelIssues(model, ctx);          // tiers 1–2 (shared with EditFile)
      if (issues.length > 0) {
        problems.push(...issues.map((i) => `Semantic model "${model.name}": ${i}`));
        nextModels.push(model);
        continue;
      }
      // tier 3 — dry-run the scoped probe set against the real engine.
      const oldModel = (oldVersion?.semanticModels ?? []).find((m) => m.name === model.name);
      const stamped = await dryRunModel(model, oldModel, { views, ctx, user, problems });
      nextModels.push(stamped);
    }
    nextVersions.push({ ...version, semanticModels: nextModels });
  }

  if (problems.length > 0) throw new SemanticModelSaveError(problems);
  return { ...content, versions: nextVersions };
}

// Tiers 1–2 (`semanticModelIssues`) and the probe spec they share with tier 3
// live in ./edit-check — the pure module the browser-side EditFile path imports.

// ── Tier 3: dry-run against the engine ───────────────────────────────────────

interface DryRunEnv {
  views: ViewDef[];
  ctx: { fullSchema: DatabaseWithSchema[]; views: ViewDef[]; otherModelNames: string[] };
  user: EffectiveUser;
  problems: string[];
}

/** Dry-run the scoped probe set for one model; returns the stamped model. */
async function dryRunModel(
  model: SemanticModelV2,
  oldModel: SemanticModelV2 | undefined,
  env: DryRunEnv,
): Promise<SemanticModelV2> {
  const metrics = model.metrics ?? [];
  if (metrics.length === 0) return model;

  const probeNames = probeScope(model, oldModel);
  if (probeNames.size === 0) return withPreservedStamps(model, oldModel);

  const dialect = await dialectFor(model.connection, env.user);
  const outcomes = new Map<string, boolean>(); // name → verified
  const queue = metrics.filter((m) => probeNames.has(m.name));
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const metric = queue.shift();
      if (!metric) return;
      try {
        await runProbe(model, metric, dialect, env);
        outcomes.set(metric.name, true);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (INFRA_ERROR.test(message)) {
          // Fail OPEN: a down warehouse must not make models uneditable.
          outcomes.set(metric.name, false);
        } else {
          env.problems.push(`Semantic model "${model.name}": metric "${metric.name}" failed engine validation: ${message}`);
        }
      }
    }
  }));

  return withPreservedStamps(model, oldModel, outcomes);
}

/** Execute one probe: compiled spec → SQL → view-inlined → LIMIT 0 wrap. */
async function runProbe(
  model: SemanticModelV2,
  metric: SemanticMetricV2,
  dialect: string,
  env: DryRunEnv,
): Promise<void> {
  const ir = compileSemanticQuery(probeSpec(model, metric), model) as QueryIR;
  // Zero-dimension models: inject the first exposed primary column as the
  // GROUP BY (plain-column grouping — standard SQL everywhere) so a
  // non-aggregate metric fails GROUP BY validation in the engine itself.
  if (!ir.group_by) {
    const col = primaryFieldNames(model, env.ctx)[0];
    if (col) {
      const table = ir.joins?.length
        ? (model.primary.kind === 'table' ? model.primary.table : model.primary.view)
        : undefined;
      ir.select.unshift({ type: 'column', column: col, ...(table ? { table } : {}), alias: '_probe_dim' });
      ir.group_by = { columns: [{ column: col, ...(table ? { table } : {}) }] };
    } else {
      // Last resort — no exposed column is known (e.g. a view whose columns
      // have not been snapshotted yet). The probe MUST still carry a GROUP BY:
      // tier 3 is the only aggregate gate by design, so dropping it would let
      // a non-aggregate metric be stamped verified and fail at query time.
      ir.select.unshift({ type: 'raw', raw_sql: '1', alias: '_probe_dim' });
      ir.group_by = { columns: [{ column: '1' }] };
    }
  }
  const sql = irToSqlLocal(ir, dialect);
  const resolved = await resolveViewsInSql(sql, dialect, env.views as never);
  await runQuery(model.connection, `SELECT * FROM (\n${resolved}\n) AS _probe LIMIT 0`, {}, env.user);
}

/**
 * Which metric names to probe. Exactly three scope cases + the sticky rule:
 *  - structural change (anything outside metrics/description fields) → ALL
 *  - metric-text-only → added/changed metrics (a pure deletion probes nothing)
 *  - metadata-only → none
 *  … plus every metric whose STORED `verified` is false (sticky until green).
 */
function probeScope(model: SemanticModelV2, oldModel: SemanticModelV2 | undefined): Set<string> {
  const metrics = model.metrics ?? [];
  const names = new Set<string>();
  if (!oldModel || structureOf(model) !== structureOf(oldModel)) {
    for (const m of metrics) names.add(m.name);
    return names;
  }
  const oldEssence = new Map((oldModel.metrics ?? []).map((m) => [m.name, metricEssence(m)]));
  for (const m of metrics) {
    if (oldEssence.get(m.name) !== metricEssence(m)) names.add(m.name); // added or changed
  }
  for (const m of oldModel.metrics ?? []) {
    if (m.verified === false && metrics.some((n) => n.name === m.name)) names.add(m.name); // sticky
  }
  return names;
}

/** Model identity minus metrics and pure-metadata fields (descriptions/labels). */
function structureOf(m: SemanticModelV2): string {
  return sortedJson({
    name: m.name,
    connection: m.connection,
    primary: m.primary,
    primaryKey: m.primaryKey ?? null,
    references: m.references ?? [],
    dimensions: m.dimensions.map((d) => ({ name: d.name, source: d.source, column: d.column, temporal: d.temporal ?? null })),
    measures: m.measures.map((ms) => ({ name: ms.name, agg: ms.agg, column: ms.column ?? null })),
    timeDimension: m.timeDimension ? { column: m.timeDimension.column } : null,
  });
}

/** Metric identity minus metadata (`description`) and the server stamp. */
function metricEssence(m: SemanticMetricV2): string {
  return JSON.stringify(m.type === 'sql'
    ? { name: m.name, type: m.type, sql: m.sql }
    : { name: m.name, type: m.type, numerator: m.numerator, denominator: m.denominator });
}

/**
 * Apply probe outcomes; metrics NOT probed keep the STORED stamp (`verified`
 * is server-managed — a client-sent value is never trusted, same rule as
 * story compiledCss).
 */
function withPreservedStamps(
  model: SemanticModelV2,
  oldModel: SemanticModelV2 | undefined,
  outcomes?: Map<string, boolean>,
): SemanticModelV2 {
  const oldByName = new Map((oldModel?.metrics ?? []).map((m) => [m.name, m]));
  return {
    ...model,
    metrics: (model.metrics ?? []).map((m) => {
      const probed = outcomes?.get(m.name);
      const verified = probed !== undefined ? probed : oldByName.get(m.name)?.verified;
      const { verified: _clientSent, ...rest } = m;
      return verified === undefined ? (rest as SemanticMetricV2) : ({ ...rest, verified } as SemanticMetricV2);
    }),
  };
}

// eslint-disable-next-line no-restricted-syntax -- keyed by (mode, connection); a dialect is immutable per connection type, and this only avoids re-reading the connection doc within a single save (same pattern as the views gate)
const dialectCache = new Map<string, string>();
async function dialectFor(connection: string, user: EffectiveUser): Promise<string> {
  const key = `${user.mode}|${connection}`;
  const hit = dialectCache.get(key);
  if (hit) return hit;
  try {
    const { type } = await ConnectionsAPI.getRawByName(connection, user.mode);
    const dialect = connectionTypeToDialect(type);
    dialectCache.set(key, dialect);
    return dialect;
  } catch {
    return 'duckdb';
  }
}

/**
 * Names of every semantic model visible in this content (inherited + all
 * versions') — the reverse half of the shared model/view namespace: the VIEWS
 * gate calls this to refuse a view named like a model.
 */
export function semanticModelNames(content: ContextContent): Set<string> {
  const names = new Set<string>();
  for (const m of content.fullSemanticModels ?? []) names.add(m.name.toLowerCase());
  for (const v of content.versions ?? []) {
    for (const m of v.semanticModels ?? []) names.add(m.name.toLowerCase());
  }
  return names;
}
