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
