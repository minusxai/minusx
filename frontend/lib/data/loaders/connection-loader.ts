/**
 * Connection Loader
 * Adds cached schema to connection files, with refresh capability
 */

import { DbFile, ConnectionContent, DatabaseSchema } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { updateCachedSchema } from '@/lib/data/connections.server';
import { CustomLoader } from './types';
import { getNodeConnector } from '@/lib/connections';
import { resolveConnectionSecrets } from '@/lib/secrets/connection-secrets.server';
import { profileDatabase } from '@/lib/connections/statistics-engine';
import { getSafeConfig } from '@/lib/data/helpers/connections';

/**
 * Check if schema is stale (older than 24 hours)
 */
function isSchemaStale(updatedAt: string): boolean {
  const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
  const schemaAge = Date.now() - new Date(updatedAt).getTime();
  return schemaAge > STALE_THRESHOLD_MS;
}

/**
 * Connection loader - Adds schema with caching
 *
 * Caching strategy (stale-while-revalidate):
 * 1. Fresh cached schema → return it, no fetch
 * 2. Stale cached schema (>24h) or backgroundRefresh → return it NOW, refresh
 *    + persist in the background (introspection can take minutes)
 * 3. No schema at all → block on the first introspection
 * 4. refresh=true (user-initiated) → block until fresh
 * Concurrent loads of the same connection share one in-flight introspection.
 */
function redactConfig(file: DbFile): DbFile {
  if (file.content === null) return file;
  const content = file.content as ConnectionContent;
  return {
    ...file,
    content: { ...content, config: getSafeConfig(content.type, content.config) },
  };
}

export const connectionLoader: CustomLoader = async (file, user, options) =>
  redactConfig(await loadConnectionSchema(file, user, options));

// In-flight introspections by file id: concurrent loads of the same connection
// share ONE schema fetch instead of stampeding the warehouse/DuckDB.
// Cross-request sharing is the point — the schema is connection-scoped (file id
// IS the scope key), not user-scoped; per-user redaction happens after loading.
// eslint-disable-next-line no-restricted-syntax
const inflightRefreshes = new Map<number, Promise<DbFile>>();

function refreshSchema(file: DbFile): Promise<DbFile> {
  const existing = inflightRefreshes.get(file.id);
  if (existing) return existing;
  const refresh = fetchAndPersistSchema(file).finally(() => inflightRefreshes.delete(file.id));
  inflightRefreshes.set(file.id, refresh);
  return refresh;
}

const loadConnectionSchema: CustomLoader = async (file: DbFile, _user: EffectiveUser, options?) => {
  // Skip if metadata-only
  if (file.content === null) {
    return file;
  }

  const content = file.content as ConnectionContent;

  const hasSchema = content.schema && content.schema.schemas;
  const hasTimestamp = content.schema?.updated_at;
  // If no timestamp, schema is from old version (pre-migration) - treat as stale
  const isStale = hasTimestamp ? isSchemaStale(hasTimestamp) : true;

  // Explicit refresh is user-initiated: block until the fresh schema is ready
  if (options?.refresh) {
    return refreshSchema(file);
  }

  if (hasSchema) {
    // Stale-while-revalidate: serve the cached schema immediately; introspection
    // (which can take minutes on large connections) runs in the background and
    // persists via updateCachedSchema for the next load.
    if (isStale || options?.backgroundRefresh) {
      void refreshSchema(file).catch((error) => {
        console.error(`[connectionLoader] Background schema refresh failed for ${file.name}:`, error);
      });
    }
    return file;
  }

  // No schema at all — nothing to serve, block on the first introspection
  return refreshSchema(file);
};

async function fetchAndPersistSchema(file: DbFile): Promise<DbFile> {
  const content = file.content as ConnectionContent;
  const hasSchema = content.schema && content.schema.schemas;

  // Fetch fresh schema via the Node.js connector for the connection's type.
  let freshSchema: DatabaseSchema;
  try {
    const connector = getNodeConnector(file.name, content.type, await resolveConnectionSecrets(content.config));
    const result = connector ? { schemas: await connector.getSchema() } : { schemas: [] };

    // Enrich schema with column metadata (descriptions, categories, top values, etc.)
    let enrichedSchemas = result.schemas;
    if (connector) {
      try {
        const profile = await profileDatabase(content.type, result.schemas, (sql) => connector.query(sql));
        enrichedSchemas = profile.schema;
      } catch (e) {
        console.warn(`[connectionLoader] Failed to enrich schema for ${file.name}, using plain schema:`, e);
      }
    }

    // Defense-in-depth: if the fetch returned no schemas but we have a non-empty
    // cached schema, keep the cache. An empty result here usually means the
    // remote query partially failed (e.g. permission-restricted role + missing
    // pg_stats), and clobbering a known-good schema with [] is far more harmful
    // than serving slightly stale enrichment data.
    if (enrichedSchemas.length === 0 && hasSchema && (content.schema!.schemas?.length ?? 0) > 0) {
      console.warn(`[connectionLoader] Refresh returned 0 schemas for ${file.name}; keeping cached schema (was ${content.schema!.schemas.length} schemas)`);
      return file;
    }

    freshSchema = {
      schemas: enrichedSchemas,
      updated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error(`[connectionLoader] Failed to fetch schema for ${file.name}:`, error);
    // If fetch fails but we have cached schema, return it
    if (hasSchema) {
      return file;
    }
    // Otherwise return empty schema with timestamp
    freshSchema = {
      schemas: [],
      updated_at: new Date().toISOString()
    };
  }

  // Update file in database with fresh schema
  try {
    await updateCachedSchema(file.id, file.name, file.path, freshSchema, file.references);
  } catch (error) {
    console.error(`[connectionLoader] Failed to save schema for ${file.name}:`, error);
    // Continue anyway - we can still return the fresh schema
  }

  // Return file with fresh schema
  return {
    ...file,
    content: {
      ...content,
      schema: freshSchema
    }
  };
}
