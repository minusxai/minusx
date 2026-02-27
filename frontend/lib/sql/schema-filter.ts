/**
 * Shared schema filtering logic
 * Used by both client-side (useContext hook) and server-side (ContextHelpers)
 */
import { DatabaseSchema, WhitelistItem, ContextContent, DatabaseWithSchema } from '../types';
import { getPublishedVersionForUser } from '../context/context-utils';

/**
 * Filter schema based on whitelist items
 * @param fullSchema - The full database schema
 * @param whitelist - Array of whitelist items
 * @param currentPath - Optional path of child context requesting filtering
 */
export function filterSchemaByWhitelist(
  fullSchema: DatabaseSchema,
  whitelist: WhitelistItem[],
  currentPath?: string
): DatabaseSchema {
  // Filter whitelist items by childPaths BEFORE creating lookup sets
  const applicableWhitelist = whitelist.filter(item => {
    // If childPaths is undefined/null, apply to all children (backward compatible)
    // If childPaths is [] (empty array), apply to NO children (only this folder)
    if (!item.childPaths) {
      return true;
    }
    if (item.childPaths.length === 0) {
      return false;
    }
    // If currentPath not provided, include all (for non-child contexts)
    if (!currentPath) {
      return true;
    }
    // Check if currentPath matches any childPaths (including nested paths)
    return item.childPaths.some(childPath =>
      currentPath === childPath || currentPath.startsWith(childPath + '/')
    );
  });

  // Create lookup maps for faster filtering
  const whitelistedSchemas = new Set(
    applicableWhitelist.filter(w => w.type === 'schema').map(w => w.name)
  );

  const whitelistedTables = new Map<string, Set<string>>();
  applicableWhitelist.filter(w => w.type === 'table').forEach(w => {
    if (w.schema) {
      if (!whitelistedTables.has(w.schema)) {
        whitelistedTables.set(w.schema, new Set());
      }
      whitelistedTables.get(w.schema)!.add(w.name);
    }
  });

  // Filter schemas
  const filteredSchemas = fullSchema.schemas
    .map(schema => {
      const schemaName = schema.schema;

      // If entire schema is whitelisted, include all tables
      if (whitelistedSchemas.has(schemaName)) {
        return schema;
      }

      // Otherwise, filter tables
      const allowedTables = whitelistedTables.get(schemaName);
      if (!allowedTables || allowedTables.size === 0) {
        return null; // No tables from this schema are whitelisted
      }

      return {
        ...schema,
        tables: schema.tables.filter(table => allowedTables.has(table.table))
      };
    })
    .filter(schema => schema !== null && schema.tables.length > 0) as DatabaseSchema['schemas'];

  return { schemas: filteredSchemas, updated_at: fullSchema.updated_at };
}

/**
 * Apply context's whitelist to its fullSchema
 * Returns only the schemas/tables that are whitelisted in this context
 *
 * @param contextContent - The context content with fullSchema and databases (whitelist)
 * @param currentPath - Optional path of child context requesting filtering
 * @returns Array of databases with whitelisted schemas/tables only
 */
export function getWhitelistedSchema(
  contextContent: ContextContent,
  currentPath?: string
): DatabaseWithSchema[] {
  if (!contextContent.fullSchema || !contextContent.databases) {
    return [];
  }

  const fullSchema = contextContent.fullSchema;
  const databases = contextContent.databases;

  return databases.map(dbContext => {
    // Find the available database in fullSchema
    const availableDb = fullSchema.find(
      fs => fs.databaseName === dbContext.databaseName
    );

    if (!availableDb) return null;

    // Apply whitelist filter
    const filteredSchema = filterSchemaByWhitelist(
      { schemas: availableDb.schemas, updated_at: availableDb.updated_at || new Date().toISOString() },
      dbContext.whitelist,
      currentPath
    );

    return {
      databaseName: dbContext.databaseName,
      schemas: filteredSchema.schemas
    };
  }).filter(Boolean) as DatabaseWithSchema[];
}

/**
 * Find matching context file for a given path and database
 * Note: This function appears to be unused legacy code
 */
export function findMatchingContext(
  contextFiles: any[],
  path: string,
  databaseName: string
): any | null {
  return contextFiles.find(ctx => {
    // Note: Context format is legacy (databaseName, whitelist) not fully typed
    const contextContent = ctx.content;

    // Must match database name
    if (contextContent.databaseName !== databaseName) return false;

    // Get directory containing the context file
    const contextDir = ctx.path.substring(0, ctx.path.lastIndexOf('/')) || '/';
    const searchDir = path.substring(0, path.lastIndexOf('/')) || '/';

    // Context applies if it's in an ancestor directory
    return searchDir.startsWith(contextDir);
  }) || null;
}

/**
 * Find all matching context files for a given path (without database filter)
 * Returns all contexts in the current path or any parent paths
 */
/**
 * Find contexts that apply to a given path
 * Matches contexts that are ancestors or exact matches (by directory, not name)
 *
 * Note: contextFiles should already be filtered by type='context'
 */
export function findMatchingContextByPath(
  contextFiles: any[],
  path: string
): any[] {
  return contextFiles.filter(ctx => {
    // Get the directory containing the context file
    const contextDir = ctx.path.substring(0, ctx.path.lastIndexOf('/')) || '/';

    // Context applies if its directory is an ancestor of the path (not equal to it)
    // A context at /dir/context applies to /dir/subdir but NOT /dir itself
    if (contextDir === '/') {
      // Special case: root context applies to everything below root
      return path.startsWith('/') && path !== '/';
    } else {
      // Context must be in a parent directory, not the same directory
      return path.startsWith(contextDir + '/');
    }
  });
}

/**
 * Get whitelisted schema for a user's published version
 * Filters fullSchema by the published version's whitelist
 *
 * @param contextContent - The context content with versions and fullSchema
 * @param userId - The user ID to get the published version for
 * @param currentPath - Optional path of child context requesting filtering
 * @returns Array of databases with whitelisted schemas/tables only
 */
export function getWhitelistedSchemaForUser(
  contextContent: ContextContent,
  userId: number,
  currentPath?: string
): DatabaseWithSchema[] {
  // Get user's published version and compute visible schema from it
  if (contextContent.versions && contextContent.versions.length > 0) {
    const publishedVersionNum = getPublishedVersionForUser(contextContent, userId);
    const publishedVersion = contextContent.versions.find(v => v.version === publishedVersionNum);

    if (publishedVersion) {
      // Filter fullSchema by this version's whitelist to get visible schema
      const databases = publishedVersion.databases.map(dbContext => {
        const availableDb = contextContent.fullSchema?.find(
          fs => fs.databaseName === dbContext.databaseName
        );
        if (!availableDb) return null;

        const filteredSchema = filterSchemaByWhitelist(
          { schemas: availableDb.schemas, updated_at: availableDb.updated_at || new Date().toISOString() },
          dbContext.whitelist,
          currentPath
        );

        return {
          databaseName: dbContext.databaseName,
          schemas: filteredSchema.schemas
        };
      }).filter(Boolean) as DatabaseWithSchema[];

      return databases;
    }
  }

  // Legacy fallback for contexts without versions
  if (contextContent.fullSchema) {
    return contextContent.fullSchema;
  }

  return [];
}

/**
 * Get documentation for a user's published version
 *
 * @param contextContent - The context content with versions
 * @param userId - The user ID to get the published version for
 * @returns Documentation string or undefined
 */
export function getDocumentationForUser(
  contextContent: ContextContent,
  userId: number
): string | undefined {
  // Collect inherited docs (fullDocs) filtered by childPaths (already filtered by loader)
  const inheritedDocStrings = (contextContent.fullDocs || []).map(doc =>
    typeof doc === 'string' ? doc : doc.content
  );

  // Get user's published version and return its docs
  if (contextContent.versions && contextContent.versions.length > 0) {
    const publishedVersionNum = getPublishedVersionForUser(contextContent, userId);
    const publishedVersion = contextContent.versions.find(v => v.version === publishedVersionNum);

    if (publishedVersion && publishedVersion.docs) {
      // Handle DocEntry[] format (post-migration v11)
      const ownDocStrings = publishedVersion.docs.map(doc =>
        typeof doc === 'string' ? doc : doc.content
      );
      const allDocStrings = [...inheritedDocStrings, ...ownDocStrings].filter(Boolean);
      return allDocStrings.length > 0 ? allDocStrings.join('\n\n---\n\n') : undefined;
    }
  }

  // Legacy fallback or no own docs — return inherited only
  return inheritedDocStrings.length > 0 ? inheritedDocStrings.join('\n\n---\n\n') : undefined;
}
