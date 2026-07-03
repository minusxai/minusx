/**
 * Pure helpers for turning a dashboard's assets into the grid's layoutable set.
 *
 * The grid key MUST be unique per asset: react-grid-layout indexes its internal
 * layout by child key, and React reconciles children by key — duplicate keys
 * corrupt RGL's layout array (holes → `bottom()` reads `.y` of undefined →
 * crash) and drop children. Dashboards can accumulate duplicate assets/layout
 * items from repeated edits, so we dedupe here as the single chokepoint both the
 * layout computation and the child render read from.
 */
import { AssetReference, DashboardLayoutItem, InlineAsset } from '@/lib/types';
import type { Layout } from 'react-grid-layout';

// Grid sizing defaults. Kept here (not in DashboardView) so the pure layout
// computation is self-contained and unit-testable.
const DASHBOARD_MIN_W = 2;
const DASHBOARD_MIN_H = 2;
const DASHBOARD_DEFAULT_W = 6;
const DASHBOARD_DEFAULT_H = 6;
const TEXT_BLOCK_DEFAULT_W = 6;
const TEXT_BLOCK_DEFAULT_H = 3;
const TEXT_BLOCK_MIN_W = 2;
const TEXT_BLOCK_MIN_H = 1;

type Layouts = { lg: Layout[]; md: Layout[]; sm: Layout[]; xs: Layout[]; xxs: Layout[] };

/** Get the grid layout key for an asset (string for both question IDs and inline asset UUIDs). */
export const getAssetLayoutKey = (asset: AssetReference): string => {
  if (asset.type === 'question') return (asset as { id: number }).id.toString();
  return (asset as InlineAsset).id || '';
};

/**
 * Assets that participate in the grid layout (questions and text blocks),
 * deduped by layout key (first occurrence wins) so the grid never receives
 * duplicate keys.
 */
export const getLayoutableAssets = (assets: AssetReference[]): AssetReference[] => {
  const layoutable = (assets ?? []).filter(asset =>
    (asset.type === 'question' && 'id' in asset && asset.id) ||
    (asset.type === 'text' && 'id' in asset && asset.id),
  );
  const seen = new Set<string>();
  const unique: AssetReference[] = [];
  for (const asset of layoutable) {
    const key = getAssetLayoutKey(asset);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(asset);
  }
  return unique;
};

/**
 * A stable signature of what the grid layout depends on: the ordered set of
 * layoutable assets by key + type. Crucially it is INVARIANT to a text block's
 * content, so editing text doesn't change it. Used as the memo key for the
 * layout computation so typing can't force a whole-grid re-layout (or regenerate
 * the grid background) on every debounced keystroke.
 */
export const getLayoutSignature = (assets: AssetReference[]): string =>
  getLayoutableAssets(assets).map(a => `${getAssetLayoutKey(a)}:${a.type}`).join(',');

/** Stack all layoutable assets vertically full-width (used when there are no saved layout items). */
const generateDefaultLayout = (assets: AssetReference[]): Layout[] => {
  const layoutable = getLayoutableAssets(assets);
  let currentY = 0;
  return layoutable.map((asset) => {
    const isText = asset.type === 'text';
    const w = isText ? TEXT_BLOCK_DEFAULT_W : DASHBOARD_DEFAULT_W;
    const h = isText ? TEXT_BLOCK_DEFAULT_H : DASHBOARD_DEFAULT_H;
    const layout: Layout = {
      i: getAssetLayoutKey(asset),
      x: 0,
      y: currentY,
      w,
      h,
      minW: isText ? TEXT_BLOCK_MIN_W : DASHBOARD_MIN_W,
      minH: isText ? TEXT_BLOCK_MIN_H : DASHBOARD_MIN_H,
    };
    currentY += h;
    return layout;
  });
};

/** Compact a layout for mobile by stacking every card vertically, full width. */
const compactMobileLayout = (layout: Layout[], toCols: number): Layout[] => {
  const sorted = [...layout].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  let currentY = 0;
  return sorted.map(item => {
    const result = { ...item, x: 0, y: currentY, w: toCols, minW: toCols };
    currentY += item.h;
    return result;
  });
};

/**
 * Pure computation of the responsive grid `layouts` object from a dashboard's
 * assets, its saved layout items, and any view-only "Read more" height overrides.
 *
 * Deliberately independent of a text block's CONTENT — two documents that differ
 * only in text content produce value-equal layouts. Callers should memoize on
 * {@link getLayoutSignature} (+ layout items + overrides), NOT on the assets
 * array identity, so text edits don't churn the grid.
 */
export const computeDashboardLayouts = (
  assets: AssetReference[],
  layoutItems: DashboardLayoutItem[] | undefined,
  textBlockRows: Record<string, number>,
): Layouts => {
  const layoutableAssets = getLayoutableAssets(assets);

  let baseLayout: Layout[];
  if (layoutItems) {
    const layoutMap = new Map<string, DashboardLayoutItem>(layoutItems.map(item => [String(item.id), item]));
    const maxY = layoutItems.reduce((max, item) => Math.max(max, item.y + item.h), 0);

    let missingCount = 0;
    baseLayout = layoutableAssets.map((asset) => {
      const id = getAssetLayoutKey(asset);
      const item = layoutMap.get(id);
      const isText = asset.type === 'text';
      const minW = isText ? TEXT_BLOCK_MIN_W : DASHBOARD_MIN_W;
      const minH = isText ? TEXT_BLOCK_MIN_H : DASHBOARD_MIN_H;
      if (item) {
        return { i: id, x: item.x, y: item.y, w: item.w, h: item.h, minW, minH };
      }
      // Asset exists but has no layout entry — place below existing items with default size.
      const w = isText ? TEXT_BLOCK_DEFAULT_W : DASHBOARD_DEFAULT_W;
      const h = isText ? TEXT_BLOCK_DEFAULT_H : DASHBOARD_DEFAULT_H;
      const result = { i: id, x: isText ? 0 : (missingCount % 2) * DASHBOARD_DEFAULT_W, y: maxY + Math.floor(missingCount / 2) * h, w, h, minW, minH };
      missingCount++;
      return result;
    });
  } else {
    baseLayout = generateDefaultLayout(assets);
  }

  // Apply "Read more" expansions (view-only): grow a cell to fit revealed content,
  // never shrinking below its saved height.
  if (Object.keys(textBlockRows).length > 0) {
    baseLayout = baseLayout.map(item =>
      textBlockRows[item.i] ? { ...item, h: Math.max(item.h, textBlockRows[item.i]) } : item
    );
  }

  const mobileLayout = compactMobileLayout(baseLayout, 6);
  return { lg: baseLayout, md: baseLayout, sm: mobileLayout, xs: mobileLayout, xxs: mobileLayout };
};
