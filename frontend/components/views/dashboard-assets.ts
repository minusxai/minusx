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
import { AssetReference, InlineAsset } from '@/lib/types';

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
