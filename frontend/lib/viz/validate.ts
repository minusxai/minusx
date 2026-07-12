/**
 * ValidateVisualization (RFC §11): the agent-facing feedback pipeline for viz envelopes.
 *
 * Stages, in order (later stages only run while no errors have been found):
 *   1. envelope shape          → E_ENVELOPE
 *   2. data policy             → E_EXTERNAL_DATA / E_DATASET_NAME (url/values/foreign names)
 *   3. official grammar schema → E_SCHEMA (package-provided Vega-Lite schema via Ajv, distilled errors)
 *   4. field references        → E_FIELD_NOT_FOUND (shared walker vs result columns, with
 *                                 available-field suggestions; transform-derived names allowed)
 *   5. vega-lite compile       → W_COMPILE (captured logger; warnings never flip ok=false)
 *
 * The spec is normalized (prepareVegaLiteSpec) before stage 3 — the official top-level
 * schema requires `data`, which we inject as the reserved named dataset.
 */
import Ajv from 'ajv';
import { compile } from 'vega-lite';
import type { TopLevelSpec } from 'vega-lite';
import { parse as parseVega } from 'vega';
import vegaLiteSchema from 'vega-lite/vega-lite-schema.json';
import { VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { prepareVegaLiteSpec } from './prepare';
import { materializeRecipe } from './viz-templates';
import { collectFieldRefs, collectDerivedFieldNames, hasUnverifiableTransform } from './field-refs';
import { VIZ_DATASET_MAIN } from './types';
import type { VizIssue, VizResultColumn, VizValidationResult } from './types';

// Vega-Lite's package-provided schema compiles once per process (~400ms), then validates in <1ms.
// jsonPointers gives '/layer/1/mark'-style dataPaths that align with VizIssue.path.
let compiledVlValidator: Ajv.ValidateFunction | null = null;
function getVlValidator(): Ajv.ValidateFunction {
  if (!compiledVlValidator) {
    const ajv = new Ajv({ allErrors: false, verbose: false, jsonPointers: true });
    ajv.addFormat('color-hex', /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
    compiledVlValidator = ajv.compile(vegaLiteSchema as object);
  }
  return compiledVlValidator;
}

const err = (code: VizIssue['code'], path: string, message: string): VizIssue =>
  ({ severity: 'error', code, path, message });
const warn = (code: VizIssue['code'], path: string, message: string): VizIssue =>
  ({ severity: 'warning', code, path, message });

// ---------------------------------------------------------------------------
// Stage 1 — envelope shape
// ---------------------------------------------------------------------------
function validateEnvelopeShape(envelope: unknown): { issues: VizIssue[]; env?: VizEnvelope } {
  if (envelope == null || typeof envelope !== 'object') {
    return { issues: [err('E_ENVELOPE', '', 'viz must be an object: {version: 2, source: {…}}')] };
  }
  const env = envelope as Record<string, unknown>;
  if (env.version !== 2) {
    return { issues: [err('E_ENVELOPE', '/version', `viz.version must be 2, got ${JSON.stringify(env.version)}`)] };
  }
  const source = env.source as Record<string, unknown> | undefined;
  if (source == null || typeof source !== 'object') {
    return { issues: [err('E_ENVELOPE', '/source', 'viz.source is required: {kind: "vega-lite", grammar: "vega-lite@6", spec: {…}} or {kind: "recipe", recipe: "minusx/…@1", bindings: {…}}')] };
  }
  if (source.kind === 'recipe') {
    if (typeof source.recipe !== 'string') {
      return { issues: [err('E_ENVELOPE', '/source/recipe', 'recipe sources need a recipe id string, e.g. "minusx/funnel@1"')] };
    }
    if (source.bindings == null || typeof source.bindings !== 'object' || Array.isArray(source.bindings)) {
      return { issues: [err('E_ENVELOPE', '/source/bindings', 'recipe sources need bindings: {slotName: "columnName", …}')] };
    }
    return { issues: [], env: env as unknown as VizEnvelope };
  }
  if (source.kind === 'table' || source.kind === 'pivot') {
    if (source.columnFormats != null && (typeof source.columnFormats !== 'object' || Array.isArray(source.columnFormats))) {
      return { issues: [err('E_ENVELOPE', '/source/columnFormats', 'columnFormats must be a record keyed by result column name')] };
    }
    if (source.css != null && typeof source.css !== 'string') {
      return { issues: [err('E_ENVELOPE', '/source/css', 'css must be a string of CSS rules against the .mx-* class contract')] };
    }
    if (source.kind === 'pivot') {
      const config = source.config as Record<string, unknown> | undefined;
      if (config == null || typeof config !== 'object' || Array.isArray(config)) {
        return { issues: [err('E_ENVELOPE', '/source/config',
          'pivot sources need config: {rows: [...], columns: [...], values: [{column, aggFunction}]}')] };
      }
    }
    return { issues: [], env: env as unknown as VizEnvelope };
  }
  if (source.kind !== 'vega-lite') {
    return { issues: [err('E_ENVELOPE', '/source/kind', `unsupported source kind ${JSON.stringify(source.kind)} — available: "vega-lite", "recipe", "table", "pivot"`)] };
  }
  if (source.grammar !== VIZ_GRAMMAR_VEGA_LITE) {
    return { issues: [err('E_ENVELOPE', '/source/grammar', `source.grammar must be "${VIZ_GRAMMAR_VEGA_LITE}", got ${JSON.stringify(source.grammar)}`)] };
  }
  if (source.spec == null || typeof source.spec !== 'object' || Array.isArray(source.spec)) {
    return { issues: [err('E_ENVELOPE', '/source/spec', 'source.spec must be a Vega-Lite spec object')] };
  }
  return { issues: [], env: env as unknown as VizEnvelope };
}

// ---------------------------------------------------------------------------
// Stage 2 — data policy: only the injected named dataset is allowed, anywhere
// ---------------------------------------------------------------------------
function validateDataPolicy(node: unknown, path: string, issues: VizIssue[]): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child, i) => validateDataPolicy(child, `${path}/${i}`, issues));
    return;
  }
  const rec = node as Record<string, unknown>;
  const data = rec.data as Record<string, unknown> | null | undefined;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if ('url' in data) {
      issues.push(err('E_EXTERNAL_DATA', `${path}/data/url`,
        `external data sources are not allowed — the query result is injected as data: {"name": "${VIZ_DATASET_MAIN}"} automatically; omit \`data\` entirely`));
    } else if ('values' in data) {
      issues.push(err('E_EXTERNAL_DATA', `${path}/data/values`,
        `inline data values are not allowed — the chart always visualizes the question's query result, injected as data: {"name": "${VIZ_DATASET_MAIN}"}; omit \`data\` entirely`));
    } else if ('name' in data && data.name !== VIZ_DATASET_MAIN) {
      issues.push(err('E_DATASET_NAME', `${path}/data/name`,
        `unknown dataset ${JSON.stringify(data.name)} — the only available dataset is "${VIZ_DATASET_MAIN}" (the query result)`));
    }
  }
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'data') continue;
    if (value && typeof value === 'object') validateDataPolicy(value, `${path}/${key}`, issues);
  }
}

// ---------------------------------------------------------------------------
// Stage 3 — official grammar schema, with error distillation
// ---------------------------------------------------------------------------
// Raw Ajv output on this schema is anyOf noise (hundreds of branch errors). Distill:
// keep the errors at the DEEPEST dataPath (the branch the author was closest to),
// drop pure anyOf wrappers, and dedupe messages.
function distillSchemaErrors(errors: Ajv.ErrorObject[]): { path: string; message: string } {
  const concrete = errors.filter(e => e.keyword !== 'anyOf');
  const pool = concrete.length ? concrete : errors;
  const maxDepth = Math.max(...pool.map(e => e.dataPath.split('/').length));
  const deepest = pool.filter(e => e.dataPath.split('/').length === maxDepth);
  const path = deepest[0].dataPath;
  const messages = Array.from(new Set(deepest.slice(0, 5).map(e => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = e.params as any;
    if (e.keyword === 'enum') return `must be one of ${JSON.stringify(params.allowedValues)}`;
    if (e.keyword === 'required') return `missing required property '${params.missingProperty}'`;
    if (e.keyword === 'additionalProperties') return `unexpected property '${params.additionalProperty}'`;
    if (e.keyword === 'type') return `should be ${params.type}`;
    return e.message ?? 'invalid';
  })));
  return { path, message: `${path || 'spec'}: ${messages.join('; ')}` };
}

// ---------------------------------------------------------------------------
// Stage 4 — field references vs the actual query-result columns
// ---------------------------------------------------------------------------
function validateFieldRefs(spec: Record<string, unknown>, columns: VizResultColumn[], issues: VizIssue[]): void {
  if (hasUnverifiableTransform(spec)) return; // pivot-transform columns come from data values
  const known = new Set(columns.map(c => c.name));
  const derived = collectDerivedFieldNames(spec);
  const available = columns.map(c => `${c.name} (${c.kind})`).join(', ');
  for (const ref of collectFieldRefs(spec)) {
    if (known.has(ref.field) || derived.has(ref.field)) continue;
    issues.push(err('E_FIELD_NOT_FOUND', `/source/spec${ref.path}`,
      `"${ref.field}" is not in the query result. Available fields: ${available}${derived.size ? `. Transform-derived fields: ${Array.from(derived).join(', ')}` : ''}`));
  }
}

// ---------------------------------------------------------------------------
// Stage 5 — vega-lite compile with a captured logger
// ---------------------------------------------------------------------------
interface CapturedLog { level: 'warn' | 'error'; message: string }
function makeCapturingLogger(captured: CapturedLog[]) {
  const logger = {
    level: (_?: number) => logger,
    error: (...args: unknown[]) => { captured.push({ level: 'error', message: args.map(String).join(' ') }); return logger; },
    warn: (...args: unknown[]) => { captured.push({ level: 'warn', message: args.map(String).join(' ') }); return logger; },
    info: () => logger,
    debug: () => logger,
  };
  return logger;
}

// ---------------------------------------------------------------------------

/**
 * Validate a viz envelope. `columns` may be undefined when the query result is
 * unknown (headless paths, or an edit that changes query and viz together) —
 * field-reference checks are then SKIPPED (never false-positive against stale
 * columns); schema/policy/recipe/css checks always run.
 */
export function validateVizEnvelope(
  envelope: unknown,
  columns?: VizResultColumn[],
): VizValidationResult {
  const issues: VizIssue[] = [];

  const shape = validateEnvelopeShape(envelope);
  issues.push(...shape.issues);
  if (!shape.env) return { ok: false, issues };

  let rawSpec: Record<string, unknown>;
  const source = shape.env.source as Record<string, unknown>;
  if (source.kind === 'table' || source.kind === 'pivot') {
    // The DOM tier: no grammar to validate. Check every column reference against the
    // result columns (typo feedback, skipped when the result is unknown) and sanitize
    // the css override.
    if (columns) {
      const known = new Set(columns.map(c => c.name));
      const available = columns.map(c => `${c.name} (${c.kind})`).join(', ');
      const notFound = (path: string, name: string) =>
        issues.push(err('E_FIELD_NOT_FOUND', path, `"${name}" is not in the query result. Available fields: ${available}`));
      for (const key of Object.keys((source.columnFormats as Record<string, unknown> | null | undefined) ?? {})) {
        if (!known.has(key)) notFound(`/source/columnFormats/${key}`, key);
      }
      if (source.kind === 'pivot') {
        const config = source.config as { rows?: string[]; columns?: string[]; values?: Array<{ column?: string }> };
        (config.rows ?? []).forEach((name, i) => { if (!known.has(name)) notFound(`/source/config/rows/${i}`, name); });
        (config.columns ?? []).forEach((name, i) => { if (!known.has(name)) notFound(`/source/config/columns/${i}`, name); });
        (config.values ?? []).forEach((v, i) => {
          if (typeof v?.column === 'string' && !known.has(v.column)) notFound(`/source/config/values/${i}/column`, v.column);
        });
      }
    }
    const css = source.css as string | null | undefined;
    if (css) {
      if (/@import/i.test(css)) {
        issues.push(err('E_CSS', '/source/css', '@import is not allowed in css overrides'));
      }
      if (/url\s*\(/i.test(css)) {
        issues.push(err('E_CSS', '/source/css', 'url() is not allowed in css overrides — style with colors/fonts/spacing only'));
      }
    }
    return { ok: !issues.some(i => i.severity === 'error'), issues };
  }
  if (source.kind === 'recipe') {
    const recipeSource = source as unknown as { recipe: string; bindings: Record<string, string | string[]> };
    const materialized = materializeRecipe(recipeSource);
    if (!materialized.ok) {
      issues.push(err('E_RECIPE', '/source/recipe', materialized.error));
      return { ok: false, issues };
    }
    // Bindings are the recipe's field references — check them against the columns
    // directly (skipped when the result is unknown; the materialized spec's own
    // refs are then internally consistent either way).
    if (columns) {
      const known = new Set(columns.map(c => c.name));
      const available = columns.map(c => `${c.name} (${c.kind})`).join(', ');
      for (const [slot, bound] of Object.entries(recipeSource.bindings)) {
        for (const columnName of Array.isArray(bound) ? bound : [bound]) {
          if (!known.has(columnName)) {
            issues.push(err('E_FIELD_NOT_FOUND', `/source/bindings/${slot}`,
              `"${columnName}" is not in the query result. Available fields: ${available}`));
          }
        }
      }
      // columnFormats keys are column references too (applied at materialization).
      for (const key of Object.keys((source.columnFormats as Record<string, unknown> | null | undefined) ?? {})) {
        if (!known.has(key)) {
          issues.push(err('E_FIELD_NOT_FOUND', `/source/columnFormats/${key}`,
            `"${key}" is not in the query result. Available fields: ${available}`));
        }
      }
    }
    if (issues.some(i => i.severity === 'error')) return { ok: false, issues };
    // Native-vega recipes (e.g. radar) can't run the VL pipeline — smoke-parse the
    // materialized Vega spec instead (shipped specs; bindings already checked above).
    if (materialized.engine === 'vega') {
      try {
        parseVega(materialized.spec as never, undefined, { ast: true });
      } catch (e) {
        issues.push(err('E_SCHEMA', '/source/recipe', `materialized vega spec failed to parse: ${e instanceof Error ? e.message : String(e)}`));
        return { ok: false, issues };
      }
      return { ok: true, issues };
    }
    rawSpec = materialized.spec;
  } else {
    rawSpec = (source as { spec: Record<string, unknown> }).spec;
  }
  validateDataPolicy(rawSpec, '/source/spec', issues);
  if (issues.some(i => i.severity === 'error')) return { ok: false, issues };

  const spec = prepareVegaLiteSpec(rawSpec);

  const validate = getVlValidator();
  if (!validate(spec)) {
    const { path, message } = distillSchemaErrors(validate.errors ?? []);
    issues.push(err('E_SCHEMA', `/source/spec${path}`, message));
    return { ok: false, issues };
  }

  if (columns) validateFieldRefs(spec, columns, issues);
  if (issues.some(i => i.severity === 'error')) return { ok: false, issues };

  const captured: CapturedLog[] = [];
  try {
    // The spec passed the official JSON schema (stage 3); the TS narrowing to
    // TopLevelSpec is safe but inexpressible from Record<string, unknown>.
    compile(spec as unknown as TopLevelSpec, { logger: makeCapturingLogger(captured) as never });
  } catch (e) {
    issues.push(err('E_SCHEMA', '/source/spec', `vega-lite failed to compile the spec: ${e instanceof Error ? e.message : String(e)}`));
    return { ok: false, issues };
  }
  for (const log of captured) {
    issues.push(log.level === 'error'
      ? err('E_SCHEMA', '/source/spec', `vega-lite: ${log.message}`)
      : warn('W_COMPILE', '/source/spec', `vega-lite: ${log.message}`));
  }

  return { ok: !issues.some(i => i.severity === 'error'), issues };
}
