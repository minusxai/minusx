/**
 * Viz V2 shared contracts (docs/Visualization Arch V2.md).
 *
 * The envelope schema itself lives in lib/validation/atlas-schemas.ts (VizEnvelope);
 * these are the runtime contracts for the validation / data-binding / theme pipeline.
 */

/** The reserved dataset name the query result is injected under. */
export const VIZ_DATASET_MAIN = 'main';

/** Inferred visualization kind for a query-result column (from its SQL type). */
export type VizColumnKind = 'quantitative' | 'temporal' | 'nominal' | 'boolean' | 'unknown';

export interface VizResultColumn {
  name: string;
  kind: VizColumnKind;
}

export type VizIssueCode =
  | 'E_ENVELOPE'         // envelope shape invalid (version/source/kind/grammar)
  | 'E_RECIPE'           // unknown recipe id or missing bindings
  | 'E_SCHEMA'           // spec fails the vendored official grammar schema
  | 'E_FIELD_NOT_FOUND'  // spec references a field not in the query result
  | 'E_EXTERNAL_DATA'    // spec declares a data url / inline values (only the named dataset is allowed)
  | 'E_DATASET_NAME'     // spec names a dataset other than the reserved one
  | 'E_CSS'              // table css override uses @import / external url()
  | 'W_COMPILE';         // vega-lite compiler warning (captured logger)

export interface VizIssue {
  severity: 'error' | 'warning';
  code: VizIssueCode;
  /** JSON-pointer-ish path into the envelope/spec, e.g. '/source/spec/layer/1/encoding/y/field'. */
  path: string;
  /** Actionable, agent-readable message (includes available fields for E_FIELD_NOT_FOUND). */
  message: string;
}

export interface VizValidationResult {
  /** True when there are no error-severity issues (warnings allowed). */
  ok: boolean;
  issues: VizIssue[];
}

/** Render issues as the agent-facing feedback string (one line per issue). */
export const formatVizIssues = (issues: VizIssue[]): string =>
  issues.map(i => `[${i.severity}] ${i.code} at ${i.path || '/'}: ${i.message}`).join('\n');
