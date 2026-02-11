/**
 * Connection Loader
 * Adds cached schema to connection files, with refresh capability
 */

import { DbFile, ConnectionContent, DatabaseSchema } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getSchemaFromPython } from '@/lib/backend/python-backend';
import { DocumentDB } from '@/lib/database/documents-db';
import { CustomLoader } from './types';

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
 * Caching strategy:
 * 1. If schema exists and is fresh → return cached schema
 * 2. If schema is stale OR refresh=true → fetch fresh schema from Python
 * 3. Save updated schema back to database file
 * 4. Return file with fresh schema
 *
 * Schema staleness: 24 hours (configurable)
 */
export const connectionLoader: CustomLoader = async (file: DbFile, user: EffectiveUser, options?) => {
  // Skip if metadata-only
  if (file.content === null) {
    return file;
  }

  const content = file.content as ConnectionContent;

  // Check if we need to refresh schema
  const hasSchema = content.schema && content.schema.schemas;
  const hasTimestamp = content.schema?.updated_at;
  // If no timestamp, schema is from old version (pre-migration) - treat as stale
  const isStale = hasTimestamp ? isSchemaStale(hasTimestamp) : true;
  const needsRefresh = options?.refresh || !hasSchema || isStale;

  // Return cached schema if fresh
  if (!needsRefresh && hasSchema) {
    const ageMinutes = hasTimestamp ? Math.round((Date.now() - new Date(hasTimestamp).getTime()) / 1000 / 60) : '?';
    console.log(`[connectionLoader] Using cached schema for ${file.name} (age: ${ageMinutes} min)`);
    return file;
  }

  // Fetch fresh schema from Python backend
  console.log(`[connectionLoader] Fetching fresh schema for ${file.name} (refresh=${options?.refresh}, stale=${isStale})`);
  let freshSchema: DatabaseSchema;
  try {
    const result = await getSchemaFromPython(file.name, content.type, content.config);
    freshSchema = {
      ...result,
      updated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error(`[connectionLoader] Failed to fetch schema for ${file.name}:`, error);
    // If fetch fails but we have cached schema, return it
    if (hasSchema) {
      console.log(`[connectionLoader] Fetch failed, using stale cached schema`);
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
    const updatedContent = {
      ...content,
      schema: freshSchema
    };
    await DocumentDB.update(
      file.id,
      file.name,
      file.path,
      updatedContent,
      file.references,
      user.companyId
    );
    console.log(`[connectionLoader] Schema saved to database for ${file.name}`);
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
};
