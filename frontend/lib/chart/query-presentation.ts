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
import { RENDERABLE_CHART_TYPES } from './renderable-types';
import { isEnvelopeImageViz } from '@/lib/viz/encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

export type QueryPresentation = 'image' | 'data';

/**
 * Whether a viz can be server-rendered to a chart IMAGE — the rawData-INDEPENDENT half of the
 * presentation decision. Every file tool (ReadFiles / EditFile / ExecuteQuery) renders the chart
 * image whenever this is true and the chart actually renders, REGARDLESS of `rawData`: the image is
 * cheap and conveys shape, so it's always worth showing. `rawData` only governs whether the row data
 * is ADDITIONALLY included (see `shouldDropRows`) — it never suppresses the image.
 */
export function isImageViz(vizType: string | undefined): boolean {
  return vizType !== undefined && RENDERABLE_CHART_TYPES.has(vizType);
}

/**
 * V2-aware image gate over a file's CONTENT (Viz Arch V2 §21 item 2). A V2 `viz`
 * envelope is authoritative — every chart kind images (only the DOM-tier table/pivot
 * don't); otherwise fall back to the legacy `vizSettings.type` gate above.
 */
export function isContentImageViz(
  content: { viz?: VizEnvelope | null; vizSettings?: { type?: string } | null } | undefined,
): boolean {
  if (content?.viz) return isEnvelopeImageViz(content.viz);
  return isImageViz(content?.vizSettings?.type);
}

/**
 * Which viz an ExecuteQuery result should render as an IMAGE. A V2 `viz` envelope is
 * authoritative — when present it decides outright (chart → render it, table/pivot → no
 * image), never falling back to `vizSettings`. Only when there is no envelope does the
 * legacy `vizSettings.type` gate apply. Null = send rows, no image.
 */
export type ExecuteQueryImageSource =
  | { kind: 'envelope'; viz: VizEnvelope }
  | { kind: 'vizSettings'; vizSettings: unknown }
  | null;

export function selectExecuteQueryImage(params: { viz?: unknown; vizSettings?: unknown }): ExecuteQueryImageSource {
  if (params.viz != null) {
    const viz = params.viz as VizEnvelope;
    return isEnvelopeImageViz(viz) ? { kind: 'envelope', viz } : null;
  }
  const vizType = (params.vizSettings as { type?: string } | null | undefined)?.type;
  if (params.vizSettings && isImageViz(vizType)) return { kind: 'vizSettings', vizSettings: params.vizSettings };
  return null;
}

/**
 * The DEFAULT presentation for a result: image for a server-renderable viz, else rows. `rawData`
 * forces rows. NOTE: this folds rawData into a single 'image'|'data' verdict; the file tools instead
 * decide the image and the rows SEPARATELY (`isImageViz` for the image, `shouldDropRows` for the
 * rows) so that `rawData` returns image + rows rather than rows-only.
 */
export function queryPresentation(
  vizType: string | undefined,
  rawData: boolean | undefined,
): QueryPresentation {
  if (rawData) return 'data';
  return isImageViz(vizType) ? 'image' : 'data';
}

/**
 * Whether a tool result should DROP its rows (image-only presentation). Rows are dropped ONLY when
 * an image genuinely conveys the result — i.e. image presentation was wanted AND an image was
 * actually rendered, OR (for re-reads/edits) the result is unchanged so the chart image was already
 * sent in app state / a prior turn (the projection dedups rows). If image presentation was wanted
 * but nothing rendered (no rows, render failure, server path with no DOM, query-cache miss), KEEP
 * the rows — never leave the agent with neither an image nor data.
 *
 * `rawData: true` ALWAYS keeps the rows — the image is additive, never a replacement. This is what
 * makes the three file tools consistent: a renderable viz returns the image either way, and rawData
 * just adds the rows on top.
 */
export function shouldDropRows(opts: {
  imagePresentation: boolean;
  imageRendered: boolean;
  resultUnchanged?: boolean;
  rawData?: boolean;
}): boolean {
  if (opts.rawData) return false;
  return opts.imagePresentation && (opts.imageRendered || opts.resultUnchanged === true);
}
