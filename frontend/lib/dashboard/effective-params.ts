/**
 * Dashboard parameter merging. A dashboard hoists the parameters of its embedded questions to the
 * dashboard level (same name + type merge). This computes the value each merged parameter resolves to
 * for the embedded questions, with a deliberate precedence:
 *
 *   1. `lastExecutedParams` — what the dashboard actually submitted (the dashboard-level control wins)
 *   2. `paramValues`        — the dashboard's current parameter values
 *   3. the question's own saved default (`questionParamDefaults`)
 *   4. `''` (empty)
 *
 * Membership is tested with `in`, NOT `??`: an explicit `null` (None / skipped) or `''` at a higher
 * tier is a real value and must be preserved — never overridden by a question's default. That
 * key-existence rule is the whole point (a `??` here would resurrect the default over an intended None).
 *
 * Pure — extracted from DashboardView's render so the merge rule is unit-testable without a DOM.
 */
export function computeEffectiveSubmittedValues(
  mergedParameters: ReadonlyArray<{ name: string }>,
  lastExecutedParams: Record<string, unknown>,
  paramValues: Record<string, unknown> | undefined,
  questionParamDefaults: ReadonlyMap<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of mergedParameters) {
    if (p.name in lastExecutedParams) {
      values[p.name] = lastExecutedParams[p.name];
    } else if (paramValues && p.name in paramValues) {
      values[p.name] = paramValues[p.name];
    } else {
      values[p.name] = questionParamDefaults.get(p.name) ?? '';
    }
  }
  return values;
}
