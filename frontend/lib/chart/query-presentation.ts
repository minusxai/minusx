/**
 * How a tool (ReadFiles / ExecuteQuery) should present a query result to the LLM.
 *
 * Default (`rawData` false): if the result has a SERVER-RENDERABLE viz, send an IMAGE of the chart
 * (plus the always-on summary) instead of the row data — a picture is smaller and conveys shape
 * better, and the agent can re-request exact rows with `rawData: true`. If there is no viz, or the
 * viz is not server-renderable (table / pivot / single_value / number / trend), fall back to the
 * row data as usual. `rawData: true` always returns the rows.
 *
 * Pure + dependency-light so both the browser-bridged ReadFiles and the server ExecuteQuery share
 * one decision and it can be unit-tested directly.
 */
import { RENDERABLE_CHART_TYPES } from './render-chart-svg';

export type QueryPresentation = 'image' | 'data';

export function queryPresentation(
  vizType: string | undefined,
  rawData: boolean | undefined,
): QueryPresentation {
  if (rawData) return 'data';
  return vizType !== undefined && RENDERABLE_CHART_TYPES.has(vizType) ? 'image' : 'data';
}

/**
 * Whether a tool result should DROP its rows (image-only presentation). Rows are dropped ONLY when
 * an image genuinely conveys the result — i.e. image presentation was wanted AND an image was
 * actually rendered, OR (for re-reads/edits) the result is unchanged so the chart image was already
 * sent in app state / a prior turn (the projection dedups rows). If image presentation was wanted
 * but nothing rendered (no rows, render failure, server path with no DOM, query-cache miss), KEEP
 * the rows — never leave the agent with neither an image nor data.
 */
export function shouldDropRows(opts: {
  imagePresentation: boolean;
  imageRendered: boolean;
  resultUnchanged?: boolean;
}): boolean {
  return opts.imagePresentation && (opts.imageRendered || opts.resultUnchanged === true);
}
