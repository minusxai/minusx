/**
 * Tiers 1–2 for authored semantic models — PURE (no DB, no connector, no
 * `server-only`), so the SAME checks run in both places that need them:
 *
 *  - the save gate (`lib/semantic/save-gate.server.ts`), which adds tier 3, and
 *  - the agent's EditFile path (`lib/tools/handlers/edit-file.ts`), which runs in
 *    the BROWSER and therefore cannot import the (server-only) gate.
 *
 * Both import from here rather than re-implementing, so the agent's in-loop
 * feedback (Semantic_Model_v2.md §3) and the publish gate (§2.5) can never drift.
 *
 * Tier 3 — the `SELECT * FROM (…) LIMIT 0` warehouse dry-run — is deliberately NOT
 * here: it needs a live connector plus server credentials, and the save gate owns
 * it. An EditFile therefore returns tiers 1–2 only; the gate remains the authority.
 */
import { validateSemanticModel, type SemanticModelCtx } from './validate';
import { compileSemanticQuery, SemanticCompileError } from './compile';
import { exposedColumns } from '@/lib/types/views';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';
import type { ContextContent, SemanticModelV2, SemanticMetricV2 } from '@/lib/types';

// ── Tier 2: pure compile probe ───────────────────────────────────────────────

/**
 * Compile-probe every metric through the real compiler. Pure and synchronous —
 * catches structural compile failures tier 1 can't see; also the seam tier 3
 * builds its probe specs on.
 */
export function compileProbeIssues(model: SemanticModelV2): string[] {
  const issues: string[] = [];
  for (const metric of model.metrics) {
    try {
      compileSemanticQuery(probeSpec(model, metric), model);
    } catch (err) {
      const detail = err instanceof SemanticCompileError ? err.issues.join('; ') : (err instanceof Error ? err.message : String(err));
      issues.push(`metric "${metric.name}" does not compile: ${detail}`);
    }
  }
  return issues;
}

/**
 * Probe spec = the metric plus the first NON-m2m dimension. m2m-sourced probe
 * dimensions would add a bridge join that contributes nothing to metric
 * validation; the zero-dimension GROUP BY is injected post-compile instead
 * (§2.5 probe shape).
 */
export function probeSpec(model: SemanticModelV2, metric: SemanticMetricV2): SemanticQuerySpec {
  const m2mAliases = new Set(
    (model.references ?? []).filter((r) => r.relationship === 'many_to_many').map((r) => r.alias),
  );
  const probeDimension = model.dimensions.find((d) => !m2mAliases.has(d.source));
  return {
    model: model.name,
    table: model.primary.kind === 'table' ? model.primary.table : model.primary.view,
    schema: model.primary.kind === 'table' ? model.primary.schema ?? null : null,
    metrics: [metric.name],
    dimensions: probeDimension ? [probeDimension.name] : [],
  } as SemanticQuerySpec;
}

/**
 * Tiers 1 + 2 for one model: static rules first, then the compile probe (only
 * worth running once the static shape/refs hold). Empty ⇒ the model is as valid
 * as anything pure can prove; the engine is tier 3's authority.
 */
export function semanticModelIssues(model: SemanticModelV2, ctx: SemanticModelCtx): string[] {
  const issues = validateSemanticModel(model, ctx);
  if (issues.length === 0) issues.push(...compileProbeIssues(model));
  return issues;
}

/**
 * Deterministic stringify (recursively key-sorted). Stored JSONB (PGLite /
 * Postgres) does NOT preserve object key order — and the agent's markup round
 * trip reorders keys too — so a plain JSON.stringify comparison of new-vs-stored
 * would misclassify every save/edit as a change.
 */
export function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// ── The EditFile-facing check ────────────────────────────────────────────────

/**
 * Can tier 1's FIELD-level checks be trusted against this (client-side) menu?
 * `boundFullSchema` strips COLUMNS from a huge schema menu (it never drops
 * tables), and a context can reach the client with no menu for a connection at
 * all — in both cases every column would read as "not exposed" and tier 1 would
 * reject a perfectly good model. Degrade instead: run tier 2 only and let the
 * save gate — which recomputes the schema server-side from the whitelist — be the
 * authority. Erring toward NOT blocking is the whole point: a false block would
 * make a context uneditable.
 */
function fieldChecksTrustworthy(model: SemanticModelV2, ctx: SemanticModelCtx): boolean {
  // Optional-chained: an agent-authored model can be missing `primary` entirely at
  // runtime (tier 1's shape gate is what reports that).
  const primary = model.primary;
  if (primary?.kind === 'model') {
    const view = ctx.views.find((v) => v.name === primary.view);
    // A MISSING view is a real, reportable issue; a view whose columns were never
    // snapshotted is an unknowable one.
    return !view || exposedColumns(view).length > 0;
  }
  const db = ctx.fullSchema.find((d) => d.databaseName === model.connection);
  if (!db) return false;
  return db.schemas.some((s) => s.tables.some((t) => (t.columns?.length ?? 0) > 0));
}

/**
 * Tiers 1–2 over every authored semantic model in `next` that differs from the
 * one of the same name in `saved` — i.e. every model the author (agent EditFile,
 * or the editor UI staging into Redux) has ADDED or CHANGED since the last
 * publish. Issues are prefixed with the model name, matching the save gate's.
 *
 * Scoping to changed models is what makes this safe to BLOCK on: a model that is
 * merely stale against the warehouse (a column dropped, the whitelist narrowed)
 * never makes an unrelated docs edit un-appliable — the publish gate still calls
 * that one. Pass `saved: undefined` to check every model (non-blocking feedback).
 *
 * Never throws: a malformed context yields no issues rather than a failed tool call.
 */
export function changedSemanticModelIssues(next: unknown, saved: unknown): string[] {
  try {
    const content = next as ContextContent | undefined;
    const versions = content?.versions ?? [];
    if (!versions.some((v) => (v.semanticModels?.length ?? 0) > 0)) return [];

    const savedVersions = (saved as ContextContent | undefined)?.versions ?? [];
    const fullSchema = content?.fullSchema ?? [];
    const inheritedViews = content?.fullViews ?? [];
    const inheritedModels = content?.fullSemanticModels ?? [];

    const issues: string[] = [];
    for (const version of versions) {
      const models = version.semanticModels ?? [];
      if (models.length === 0) continue;
      const views = [...inheritedViews, ...(version.views ?? [])];
      const savedModels = savedVersions.find((v) => v.version === version.version)?.semanticModels ?? [];

      for (const model of models) {
        const before = savedModels.find((m) => m?.name === model?.name);
        if (before && sortedJson(before) === sortedJson(model)) continue; // unchanged since the last save
        const ctx: SemanticModelCtx = {
          fullSchema,
          views,
          otherModelNames: [
            ...inheritedModels.map((m) => m.name),
            ...models.filter((m) => m !== model).map((m) => m.name),
          ],
        };
        const modelIssues = fieldChecksTrustworthy(model, ctx)
          ? semanticModelIssues(model, ctx)
          : compileProbeIssues(model); // tier 2 only — see fieldChecksTrustworthy
        issues.push(...modelIssues.map((i) => `Semantic model "${model?.name ?? '(unnamed)'}": ${i}`));
      }
    }
    return issues;
  } catch {
    // Feedback must never break the edit path; the save gate still enforces.
    return [];
  }
}
