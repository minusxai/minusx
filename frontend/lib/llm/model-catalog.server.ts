/**
 * Live model catalog (server-only) — overlays https://models.dev (the open
 * catalog pi-ai bakes its registry from) onto the baked pi-ai registry, so
 * brand-new models (released after our pinned pi-ai version) appear in the
 * pickers and resolve to runnable handles without a dependency bump.
 *
 * - `getModelCatalog()` fetches + caches the catalog in-process (1h TTL);
 *   returns null on failure or in test envs — callers degrade to the baked
 *   registry, so the app never depends on models.dev availability.
 * - `mergedListModels(slug, catalog)` = baked ∪ live for one provider (live
 *   metadata wins on id collisions). Provider LIST stays pi-ai's — execution
 *   requires a pi-supported wire API; anything else is the `custom` provider.
 */
import 'server-only';
import { listModels, type RegistryModelInfo } from '@/orchestrator/llm';

export interface CatalogModel extends RegistryModelInfo {
  /** Max output tokens (models.dev `limit.output`). */
  maxTokens: number;
  /** Per-Mtok pricing when published — passed through to the model handle. */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export type ModelCatalog = Map<string, Map<string, CatalogModel>>;

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

/** Parse a models.dev api.json payload into a provider→model catalog. Pure. */
export function parseModelsDevCatalog(json: unknown): ModelCatalog {
  const catalog: ModelCatalog = new Map();
  if (!json || typeof json !== 'object') return catalog;
  for (const [providerId, provider] of Object.entries(json as Record<string, unknown>)) {
    const models = (provider as { models?: Record<string, unknown> } | null)?.models;
    if (!models || typeof models !== 'object') continue;
    const parsed = new Map<string, CatalogModel>();
    for (const [modelId, m] of Object.entries(models)) {
      if (!m || typeof m !== 'object') continue;
      const model = m as {
        name?: string; reasoning?: boolean;
        modalities?: { input?: string[]; output?: string[] };
        limit?: { context?: number; output?: number };
        cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
      };
      // CHAT models only: image-generation / TTS entries (output without
      // 'text') polluted the pickers and broke the Test button's default-model
      // fallback (alphabetical order put chatgpt-image-latest first for openai).
      if (model.modalities?.output && !model.modalities.output.includes('text')) continue;
      const input = (model.modalities?.input ?? ['text']).filter((v): v is 'text' | 'image' => v === 'text' || v === 'image');
      parsed.set(modelId, {
        id: modelId,
        name: model.name ?? modelId,
        reasoning: model.reasoning ?? false,
        input: input.length > 0 ? input : ['text'],
        contextWindow: model.limit?.context ?? 128_000,
        maxTokens: model.limit?.output ?? 8_192,
        ...(model.cost && typeof model.cost.input === 'number' && typeof model.cost.output === 'number'
          ? { cost: { input: model.cost.input, output: model.cost.output, cacheRead: model.cost.cache_read ?? 0, cacheWrite: model.cost.cache_write ?? 0 } }
          : {}),
      });
    }
    if (parsed.size > 0) catalog.set(providerId, parsed);
  }
  return catalog;
}

/** Baked ∪ live models for one provider slug; live metadata wins on collisions. */
export function mergedListModels(slug: string, catalog: ModelCatalog | null): RegistryModelInfo[] {
  const baked = listModels(slug);
  const live = catalog?.get(slug);
  if (!live) return baked;
  const merged = new Map<string, RegistryModelInfo>();
  for (const model of baked) merged.set(model.id, model);
  for (const [id, model] of live) merged.set(id, model);
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function isTestEnv(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- deterministic tests: no live network fetch under vitest
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

let cached: { at: number; catalog: ModelCatalog } | null = null;

/**
 * The live catalog, cached in-process for an hour. Null in test envs and on
 * fetch failure (stale cache is served over a failed refresh).
 */
export async function getModelCatalog(): Promise<ModelCatalog | null> {
  if (isTestEnv()) return null;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.catalog;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(MODELS_DEV_URL, { signal: controller.signal });
      if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
      const catalog = parseModelsDevCatalog(await res.json());
      if (catalog.size === 0) throw new Error('models.dev returned an empty catalog');
      cached = { at: Date.now(), catalog };
      return catalog;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.warn('[model-catalog] live catalog unavailable, using baked registry:', error instanceof Error ? error.message : error);
    return cached?.catalog ?? null;
  }
}
