/**
 * Which charts respond to wheel, drag and hover — the one definition.
 *
 * Two callers need this and they used to answer it separately: `VegaChart` (to wire
 * up view-state persistence) and the dashboard tile (to decide whether its edit-mode
 * drag surface may cover the chart). Separate answers drifted, and the drift was
 * invisible: the tile read only the LEGACY `vizSettings.type`, so a viz-first geo
 * question — where `viz` is authoritative and `vizSettings` is absent entirely —
 * looked static to it and kept the full-card overlay that eats every event.
 *
 * Detection is by CAPABILITY (the `mxViewParams` signal) rather than recipe id, so a
 * DETACHED map (kind: 'vega', no recipe) stays interactive. Recipe ids are a fast path.
 */
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { immutableSet } from '@/lib/utils/immutable-collections';

export const POINT_MAP_RECIPE = 'minusx/point-map@1';
export const CHOROPLETH_RECIPE = 'minusx/choropleth@1';

/** The `vizSettings.type` values that map onto the interactive geo recipes. */
const GEO_VIZ_TYPES = immutableSet(['choropleth', 'point_map', 'geo']);

const recipeOf = (env: VizEnvelope): string | undefined =>
  (env.source as unknown as { recipe?: string })?.recipe;

/**
 * Does a raw (detached) native-Vega spec declare this signal? Lets map capabilities
 * survive detach, when the recipe id is gone but the signals remain in the spec.
 */
export const specHasSignal = (env: VizEnvelope, name: string): boolean => {
  const src = env.source as unknown as { kind?: string; spec?: { signals?: Array<{ name?: string }> } };
  return src?.kind === 'vega' && Array.isArray(src.spec?.signals) && src.spec.signals.some(s => s?.name === name);
};

/** An envelope that pans/zooms (point_map / choropleth / a detached map spec). */
export const isInteractiveMapEnvelope = (env: VizEnvelope): boolean =>
  recipeOf(env) === POINT_MAP_RECIPE
  || recipeOf(env) === CHOROPLETH_RECIPE
  || specHasSignal(env, 'mxViewParams');

/**
 * The same question, asked of a question's CONTENT rather than a built envelope.
 *
 * Order matters and mirrors the render pipeline: `viz` wins when present (the schema
 * calls it authoritative and says legacy `vizSettings` is then ignored), and only a
 * file with no envelope falls back to the legacy type. Reversing these would
 * misclassify every file that carries both — a legacy chart later re-authored in V2
 * keeps its stale `vizSettings`.
 */
export function isInteractiveMapContent(
  content: { viz?: VizEnvelope | null; vizSettings?: { type?: string } | null } | null | undefined,
): boolean {
  if (!content) return false;
  if (content.viz) return isInteractiveMapEnvelope(content.viz);
  const t = content.vizSettings?.type;
  return !!t && GEO_VIZ_TYPES.has(t);
}
