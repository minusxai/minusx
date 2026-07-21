/**
 * The context-save gate for authored semantic models (Semantic_Model_v2.md §2.5).
 *
 * Mirrors the views gate (lib/views/save-gate.server.ts): every context write —
 * editor UI, raw JSON, agent EditFile — passes through FilesAPI.saveFile, so
 * this is the only place that can honestly enforce tier-1 validity. Tier 2
 * (compile probe) joins in M2; tier 3 (LIMIT 0 dry-run) in M4.
 */
import 'server-only';
import { computeSchemaFromWhitelist } from '@/lib/data/loaders/context-loader-utils';
import { resolveVersionWhitelist, getPublishedVersionForUser } from '@/lib/context/context-utils';
import { validateSemanticModel } from '@/lib/semantic/validate';
import { compileSemanticQuery, SemanticCompileError } from '@/lib/semantic/compile';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, DatabaseWithSchema, SemanticModelV2, ViewDef } from '@/lib/types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

export class SemanticModelSaveError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join('; '));
    this.name = 'SemanticModelSaveError';
    this.issues = issues;
  }
}

/**
 * Validate every authored semantic model in the content (tier 1). Throws
 * SemanticModelSaveError with the full issue list when any model is invalid.
 */
export async function validateSemanticModelsGate(
  content: ContextContent,
  contextPath: string,
  user: EffectiveUser,
): Promise<void> {
  const versions = content.versions ?? [];
  const hasModels = versions.some((v) => (v.semanticModels?.length ?? 0) > 0);
  if (!hasModels) return;

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
  for (const version of versions) {
    const models = version.semanticModels ?? [];
    if (models.length === 0) continue;
    const views = [...inheritedViews, ...(version.views ?? [])];
    for (const model of models) {
      const otherModelNames = [
        ...inheritedModels.map((m) => m.name),
        ...models.filter((m) => m !== model).map((m) => m.name),
      ];
      const issues = validateSemanticModel(model, { fullSchema, views, otherModelNames });
      if (issues.length === 0) issues.push(...compileProbeIssues(model));
      problems.push(...issues.map((i) => `Semantic model "${model.name}": ${i}`));
    }
  }

  if (problems.length > 0) throw new SemanticModelSaveError(problems);
}

/**
 * Tier 2: compile-probe every metric through the real compiler. Pure and
 * synchronous — catches structural compile failures tier 1 can't see, and is
 * the seam the tier-3 dry-run (M4) reuses for its probe specs.
 */
function compileProbeIssues(model: SemanticModelV2): string[] {
  const issues: string[] = [];
  // Probe dimension = the first NON-m2m dimension. Picking an m2m-sourced one
  // would make every valid m2m-only-dimension model unsaveable (m2m compiles
  // in M3), and m2m dims add nothing to metric validation anyway.
  const m2mAliases = new Set(
    (model.references ?? []).filter((r) => r.relationship === 'many_to_many').map((r) => r.alias),
  );
  const probeDimension = model.dimensions.find((d) => !m2mAliases.has(d.source));
  for (const metric of model.metrics ?? []) {
    const probe: SemanticQuerySpec = {
      model: model.name,
      table: model.primary.kind === 'table' ? model.primary.table : model.primary.view,
      schema: model.primary.kind === 'table' ? model.primary.schema ?? null : null,
      measures: [metric.name],
      dimensions: probeDimension ? [probeDimension.name] : [],
    } as SemanticQuerySpec;
    try {
      compileSemanticQuery(probe, model);
    } catch (err) {
      const detail = err instanceof SemanticCompileError ? err.issues.join('; ') : (err instanceof Error ? err.message : String(err));
      issues.push(`metric "${metric.name}" does not compile: ${detail}`);
    }
  }
  return issues;
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
