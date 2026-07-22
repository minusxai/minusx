/**
 * infer-viz — pure viz recommendations from a semantic spec's SHAPE.
 *
 * `inferVizType` is the single default applied while the chart type is
 * UNLOCKED (`vizSettings.typeLocked` falsy): time → line, dimensions → bar,
 * else table. `recommendedVizTypes` is the wider set the type selector
 * highlights — every type that makes sense for the current
 * dims/measures/time shape. Recommendations never RESTRICT: all types stay
 * clickable, the selector only emphasizes these.
 *
 * Pure and connection-agnostic, like everything in lib/semantic.
 */

import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';
import type { VizSettings } from '@/lib/validation/atlas-schemas';

export type InferredVizType = VizSettings['type'];

/** The default chart for a spec — what the explorer applies while unlocked. */
export function inferVizType(spec: SemanticQuerySpec): InferredVizType {
  if (spec.timeGrain) return 'line';
  if (spec.dimensions.length > 0) return 'bar';
  return 'table';
}

/**
 * Every chart type that fits the spec's shape, inferred default first,
 * 'table' always included (any shape renders as a table).
 */
export function recommendedVizTypes(spec: SemanticQuerySpec): InferredVizType[] {
  const dims = spec.dimensions.length;
  const measures = spec.metrics.length;
  const rec: InferredVizType[] = [inferVizType(spec)];

  if (spec.timeGrain) {
    rec.push('area', 'bar');
    if (measures >= 2) rec.push('combo');
    if (dims === 0) rec.push('trend');
  } else if (dims > 0) {
    rec.push('row');
    if (measures === 1) rec.push('pie', 'funnel');
    if (measures >= 2) rec.push('scatter');
  } else if (measures > 0) {
    rec.push('single_value');
  }
  if (dims >= 2) rec.push('pivot');

  rec.push('table');
  return [...new Set(rec)];
}
