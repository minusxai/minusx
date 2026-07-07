/**
 * Render-time style cascade for story-embedded questions:
 *
 *     story chartTheme  <  question vizSettings  <  embed styles prop
 *
 * Only the presentation groups (styleConfig, axisConfig, columnFormats, conditionalFormats,
 * singleValueConfig) participate — type/columns/pivot/geo always come from the saved question.
 * The merge never mutates its inputs and is never written back to the question file.
 *
 * VizSettings uses `null` to mean "unset", but `deepMerge` treats `null` as a value that
 * overwrites — so every overlay layer is null-pruned first: a question's explicit
 * `styleConfig: null` must not erase a story theme default.
 */
import { deepMerge } from '@/lib/utils/deep-merge';
import type { EmbedVizStyles, StoryChartTheme, VizSettings, VisualizationStyleConfig } from '@/lib/validation/atlas-schemas';

/** Recursively drop null/undefined entries (arrays pass through untouched — replace semantics). */
export function pruneNulls<T>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value == null) continue;
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? pruneNulls(value)
      : value;
  }
  return out as Partial<T>;
}

/** The vizSettings groups an embed/theme layer may override — everything else is the question's. */
export const PRESENTATION_KEYS = [
  'styleConfig', 'axisConfig', 'columnFormats', 'conditionalFormats', 'singleValueConfig',
] as const;
export type PresentationKey = (typeof PRESENTATION_KEYS)[number];
type PresentationPartial = Partial<Pick<VizSettings, PresentationKey>>;

/**
 * Project a story chartTheme into the vizSettings shape so it can ride the same merge as the
 * other layers. `palette` becomes a `styleConfig.colors` index map, which flows through the
 * existing `getEffectiveColorPalette(styleConfig?.colors, orgPalette)` plumbing — and a
 * question's own per-index color override still wins at that index.
 */
export function chartThemeToVizPartial(theme: StoryChartTheme | null | undefined): PresentationPartial {
  if (!theme) return {};
  const style: VisualizationStyleConfig = {};
  if (theme.palette?.length) {
    style.colors = Object.fromEntries(theme.palette.map((color, i) => [String(i), color]));
  }
  if (theme.background != null) style.background = theme.background;
  if (theme.textColor != null) style.textColor = theme.textColor;
  if (theme.titleColor != null) style.titleColor = theme.titleColor;
  if (theme.legend != null) style.legend = theme.legend;
  return Object.keys(style).length ? { styleConfig: style } : {};
}

/**
 * Resolve the vizSettings a story embed actually renders with.
 * Precedence per presentation group: chartTheme < question < embed styles; each layer is
 * null-pruned and deep-merged (objects merge, arrays replace wholesale).
 */
export function resolveEffectiveVizSettings(
  // A question's vizSettings is optional — a fresh question renders the table default.
  base: VizSettings | null | undefined,
  storyTheme?: StoryChartTheme | null,
  embedStyles?: EmbedVizStyles | null,
): VizSettings {
  const safeBase: VizSettings = base ?? { type: 'table' };
  const themeLayer = chartThemeToVizPartial(storyTheme);
  const embedLayer = embedStyles ? pruneNulls(embedStyles) : {};
  if (!Object.keys(themeLayer).length && !Object.keys(embedLayer).length) return safeBase;

  const result: VizSettings = { ...safeBase };
  for (const key of PRESENTATION_KEYS) {
    const layers = [themeLayer[key], pruneNulls({ v: safeBase[key] }).v, (embedLayer as PresentationPartial)[key]]
      .filter((layer): layer is NonNullable<typeof layer> => layer != null);
    if (!layers.length) continue;
    let merged = layers[0];
    for (const layer of layers.slice(1)) {
      merged = Array.isArray(layer) ? layer : deepMerge(merged as object, layer as object) as typeof merged;
    }
    (result as Record<string, unknown>)[key] = merged;
  }
  return result;
}
