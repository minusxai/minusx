/**
 * Named boundary-asset registry (RFC §9, §12): the MinusX-approved boundaries the
 * vega geo recipes look up against. Vega may NOT fetch geometry from the network (the
 * data policy rejects `data.url`), so choropleth/point recipes reference a boundary by
 * a reserved local DATASET NAME and the render pipeline injects the resolved features
 * via `view.data()` — exactly the mechanism that binds the query result under `main`.
 *
 * Only ids in this allowlist can be resolved. US/world geometry are the standard
 * projection-clean atlas boundaries (us-atlas / world-atlas — the same Natural Earth /
 * Census sources vega-datasets derives from, with `properties.name` baked in and proper
 * Alaska/Hawaii antimeridian handling for albersUsa). They ship as TopoJSON (compact,
 * shared arcs) and are converted to GeoJSON features at load; India stays a plain
 * GeoJSON FeatureCollection. All key their region name on `properties.name`.
 */
import type { Feature, FeatureCollection } from 'geojson';
import { feature as topojsonFeature } from 'topojson-client';

/**
 * The reserved dataset name a geo recipe's boundary layer references
 * (`data: {name: GEO_BOUNDARY_DATASET}`). The renderer resolves the recipe's
 * declared asset id and injects the features under this name.
 */
export const GEO_BOUNDARY_DATASET = '__mx_geo_boundary';

/** A vega projection choice paired with a boundary set (RFC §9 — vector basemap). */
export type GeoProjection = 'albersUsa' | 'mercator' | 'equalEarth';

export interface GeoAsset {
  /** Menu label. */
  label: string;
  /** Public file under `/geojson/<file>.json`. */
  file: string;
  /** GeoJSON feature `properties` key holding the region name (the lookup key). */
  nameProp: string;
  /** Vega projection that frames this boundary set well. */
  projection: GeoProjection;
  /**
   * When set, the file is a TopoJSON Topology and this names the object to extract
   * (`states`, `countries`); features are converted at load. Absent → plain GeoJSON.
   */
  topojsonObject?: string;
}

/**
 * The approved boundary sets. `albersUsa` composites Alaska/Hawaii as insets for the
 * US; world uses equalEarth; India keeps its lng/lat GeoJSON under mercator.
 */
export const GEO_ASSETS = {
  'us-states': { label: 'US (States)', file: 'us-atlas-states-10m', nameProp: 'name', projection: 'albersUsa', topojsonObject: 'states' },
  'world': { label: 'World (Countries)', file: 'world-atlas-countries-110m', nameProp: 'name', projection: 'equalEarth', topojsonObject: 'countries' },
  'india-states': { label: 'India (States)', file: 'india-states', nameProp: 'name', projection: 'mercator' },
} as const satisfies Record<string, GeoAsset>;

export type GeoAssetId = keyof typeof GEO_ASSETS;

/** The default boundary when a recipe omits `mapName`. */
export const DEFAULT_GEO_ASSET: GeoAssetId = 'us-states';

/** Menu options for the boundary-picker (Settings). */
export const GEO_ASSET_OPTIONS = (Object.keys(GEO_ASSETS) as GeoAssetId[])
  .map(value => ({ value, label: GEO_ASSETS[value].label }));

/** Whether `id` is an allowlisted boundary asset. */
export function isGeoAsset(id: unknown): id is GeoAssetId {
  return typeof id === 'string' && id in GEO_ASSETS;
}

/** Resolve `id` to a known asset, falling back to the default for unknown ids. */
export function resolveGeoAsset(id: unknown): GeoAssetId {
  return isGeoAsset(id) ? id : DEFAULT_GEO_ASSET;
}

/**
 * Extract GeoJSON features from a loaded boundary file per its asset config —
 * converting TopoJSON when the asset names an object. Pure: the render pipeline's
 * injectable seam and the unit-test entry point (no network).
 */
export function assetFeatures(id: string, json: unknown): Feature[] {
  const asset: GeoAsset | undefined = isGeoAsset(id) ? GEO_ASSETS[id] : undefined;
  if (asset?.topojsonObject) {
    // topojson-client's Topology types are structural; the object exists by construction.
    const topo = json as { objects: Record<string, unknown> };
    const collection = topojsonFeature(topo as never, topo.objects[asset.topojsonObject] as never) as unknown as FeatureCollection;
    return collection.features;
  }
  return (json as FeatureCollection).features;
}

const cache: Record<string, Feature[]> = {};

/**
 * Load an allowlisted boundary's features for injection. Rejects unknown ids —
 * geometry only ever comes from the registry, never an arbitrary reference.
 */
export async function loadGeoFeatures(id: string): Promise<Feature[]> {
  if (!isGeoAsset(id)) {
    throw new Error(`unknown geo boundary "${id}" — available: ${Object.keys(GEO_ASSETS).join(', ')}`);
  }
  if (cache[id]) return cache[id];
  const resp = await fetch(`/geojson/${GEO_ASSETS[id].file}.json`);
  if (!resp.ok) throw new Error(`Failed to load boundary "${id}" (${GEO_ASSETS[id].file})`);
  const features = assetFeatures(id, await resp.json());
  cache[id] = features;
  return features;
}
