/**
 * Semantic model CONFIG validation — the authoring-side gate. Runs live in the
 * context editor (issues shown at the card footer) and again at context save
 * (ContextContainerV2.handleSave), so a persisted context can never hold an
 * incomplete model and the query-time compiler can trust its input.
 *
 * Distinct from validateSemanticQuery (compile.ts), which checks a QUERY
 * against an already-valid model.
 */

import type { SemanticModel } from '@/lib/types/semantic';

/** Validate authored models; returns user-facing issues (empty = valid). */
export function validateSemanticModels(models: SemanticModel[] | undefined): string[] {
  const issues: string[] = [];
  if (!models?.length) return issues;

  const modelNames = new Set<string>();
  models.forEach((model, index) => {
    const label = model.name.trim() || `model ${index + 1}`;
    const push = (msg: string) => issues.push(`Semantic model "${label}": ${msg}`);

    if (!model.name.trim()) push('needs a name');
    else if (modelNames.has(model.name)) issues.push(`Duplicate semantic model name "${model.name}"`);
    modelNames.add(model.name);

    if (!model.table || !model.connection) push('needs a base table');
    if (model.measures.length === 0) push('needs at least one measure');

    const joinAliases = new Set<string>();
    (model.joins ?? []).forEach((join, i) => {
      if (!join.table || !join.alias.trim() || !join.leftColumn || !join.rightColumn) {
        push(`join ${i + 1} is incomplete (table, alias and both columns are required)`);
      }
      if (join.alias.trim()) {
        if (joinAliases.has(join.alias)) push(`duplicate join alias "${join.alias}"`);
        joinAliases.add(join.alias);
      }
    });

    const dimensionNames = new Set<string>();
    model.dimensions.forEach((dim, i) => {
      const dimLabel = dim.name.trim() || `dimension ${i + 1}`;
      if (!dim.name.trim()) push(`dimension ${i + 1} needs a name`);
      else if (dimensionNames.has(dim.name)) push(`duplicate dimension name "${dim.name}"`);
      dimensionNames.add(dim.name);
      if (!dim.column) push(`dimension "${dimLabel}" needs a column`);
      if (dim.join && !joinAliases.has(dim.join)) {
        push(`dimension "${dimLabel}" references unknown join "${dim.join}"`);
      }
    });

    const measureNames = new Set<string>();
    model.measures.forEach((measure, i) => {
      const mLabel = measure.name.trim() || `measure ${i + 1}`;
      if (!measure.name.trim()) push(`measure ${i + 1} needs a name`);
      else if (measureNames.has(measure.name)) push(`duplicate measure name "${measure.name}"`);
      measureNames.add(measure.name);
      if (measure.agg !== 'COUNT' && !measure.column) {
        push(`measure "${mLabel}" needs a column for ${measure.agg}`);
      }
    });

    (model.metrics ?? []).forEach((metric, i) => {
      const mtLabel = metric.name.trim() || `metric ${i + 1}`;
      if (!metric.name.trim()) push(`metric ${i + 1} needs a name`);
      for (const ref of [metric.numerator, metric.denominator]) {
        if (!ref) push(`metric "${mtLabel}" needs both a numerator and a denominator`);
        else if (!measureNames.has(ref)) push(`metric "${mtLabel}" references unknown measure "${ref}"`);
      }
    });
  });

  return issues;
}
