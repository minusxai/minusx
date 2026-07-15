/**
 * Viz inference for semantic specs — the "auto viz" of the semantic explorer.
 *
 * Given a SemanticQuerySpec (what's on the shelves), returns the RANKED list of
 * chart types that match the query shape, each with the axis mapping that
 * ChartBuilder expects (xCols/yCols use the compiled SELECT aliases:
 * `semanticAlias(name)` for measures/dimensions, `grain.toLowerCase()` for the
 * time bucket — the exact aliases `compileSemanticQuery` emits).
 *
 * ranked[0] is the auto-inferred default. `table` is ALWAYS a match (it is the
 * data peek). Pure and deterministic; never throws — an empty or measureless
 * spec yields just [table].
 *
 * Shape rules (extra xCols beyond the first act as series split, mirroring
 * lib/chart/aggregate-data.ts):
 *  - time + measures, no dims  → line, area, bar, table
 *  - time + measures + 1 dim   → line (dim splits series), area, table
 *  - time + measures + 2+ dims → table, line (too many series)
 *  - dims + 1 measure          → bar, row, pie (single dim only), table
 *  - 1 dim + exactly 2 measures→ scatter (measure vs measure), bar, table
 *  - dims + 2+ measures        → bar (grouped), table
 *  - exactly 1 measure alone   → single_value, table
 *  - 2+ measures alone         → table, bar
 */

import { semanticAlias } from './compile';
import type { SemanticModel } from '@/lib/types/semantic';
import type { SemanticQuerySpec, VizSettings } from '@/lib/validation/atlas-schemas';

/** One matching chart type for a spec, with its axis mapping. */
export interface VizMatch {
  type: VizSettings['type'];
  xCols: string[];
  yCols: string[];
  /** > 0 always (non-matches are omitted). Higher = better; ranked[0] is auto. */
  score: number;
}

/** Ranked matching chart types for the spec. ranked[0] is the auto default. */
export function inferVizForSpec(spec: SemanticQuerySpec, model?: SemanticModel): VizMatch[] {
  void model;
  const measures = spec.measures.map(semanticAlias);
  const dims = spec.dimensions.map(semanticAlias);
  const time = spec.timeGrain ? spec.timeGrain.toLowerCase() : null;

  // Default cartesian mapping: time bucket first, then dims (series split), measures on y.
  const xCols = [...(time ? [time] : []), ...dims];
  const std = (type: VizSettings['type'], score: number): VizMatch => ({ type, xCols, yCols: measures, score });

  if (measures.length === 0) return [std('table', 100)];

  const ranked: VizMatch[] = [];
  if (time) {
    if (dims.length === 0) ranked.push(std('line', 100), std('area', 90), std('bar', 80));
    else if (dims.length === 1) ranked.push(std('line', 100), std('area', 90));
    else ranked.push(std('table', 100), std('line', 90));
  } else if (dims.length > 0) {
    if (measures.length === 1) {
      ranked.push(std('bar', 100), std('row', 90));
      if (dims.length === 1) ranked.push(std('pie', 80));
    } else if (measures.length === 2 && dims.length === 1) {
      // Measure-vs-measure scatter: one point per dimension value.
      ranked.push({ type: 'scatter', xCols: [measures[0]], yCols: [measures[1]], score: 100 });
      ranked.push(std('bar', 90));
    } else {
      ranked.push(std('bar', 100));
    }
  } else {
    if (measures.length === 1) ranked.push({ type: 'single_value', xCols: [], yCols: measures, score: 100 });
    else ranked.push(std('table', 100), std('bar', 90));
  }

  if (!ranked.some((m) => m.type === 'table')) {
    ranked.push(std('table', ranked[ranked.length - 1].score - 10));
  }
  return ranked;
}

/** The auto-inferred viz for a spec — first ranked match. */
export function autoVizForSpec(spec: SemanticQuerySpec, model?: SemanticModel): VizMatch {
  return inferVizForSpec(spec, model)[0];
}
