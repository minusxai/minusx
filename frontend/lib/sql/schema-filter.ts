/**
 * Shared schema filtering logic
 * Used by both client-side (useContext hook) and server-side (ContextHelpers)
 */
import { DatabaseSchema, WhitelistItem, ContextContent, DatabaseWithSchema, Whitelist, WhitelistNode } from '../types';
import { getPublishedVersionForUser } from '../context/context-utils';

// ─────────────────────────────────────────────────────────────────────────────
// NEW API: Whitelist tree filtering (WhitelistNode / Whitelist)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a whitelist node's childPaths restriction allows the given currentPath.
 * - undefined childPaths → no restriction (always passes)
 * - empty array → blocks all paths
 * - non-empty array → currentPath must be exactly one of the listed paths or a descendant
 */
function childPathAllowed(node: WhitelistNode, currentPath?: string): boolean {
  if (!node.childPaths) return true;       // no restriction
  if (!currentPath) return true;           // no path given → include all
  if (node.childPaths.length === 0) return false;  // empty → nowhere
  return node.childPaths.some(cp =>
    currentPath === cp || currentPath.startsWith(cp + '/')
  );
}

/**
 * Apply a single connection-level WhitelistNode to a DatabaseSchema.
 * Returns the filtered schema (may have empty schemas array if nothing allowed).
 *
 * @param fullSchema  - Full schema for this connection
 * @param connNode    - WhitelistNode of type:'connection'
 * @param currentPath - Optional requesting path (used for childPaths filtering)
 */
export function filterSchemaByWhitelistNode(
  fullSchema: DatabaseSchema,
  connNode: WhitelistNode,
  currentPath?: string,
): DatabaseSchema {
  // Check connection-level childPaths
  if (!childPathAllowed(connNode, currentPath)) {
    return { ...fullSchema, schemas: [] };
  }

  // children:undefined → expose all schemas unchanged
  if (connNode.children === undefined) {
    return fullSchema;
  }

  // children:[] → expose nothing
  if (connNode.children.length === 0) {
    return { ...fullSchema, schemas: [] };
  }

  // Filter schemas by children
  const filteredSchemas = fullSchema.schemas.flatMap(schema => {
    const schemaNode = connNode.children!.find(n => n.name === schema.schema);
    if (!schemaNode) return [];

    // Check schema-level childPaths
    if (!childPathAllowed(schemaNode, currentPath)) return [];

    // children:undefined → expose all tables
    if (schemaNode.children === undefined) {
      return [schema];
    }

    // children:[] → expose nothing from this schema
    if (schemaNode.children.length === 0) {
      return [];
    }

    // Filter tables by children
    const filteredTables = schema.tables.filter(table => {
      const tableNode = schemaNode.children!.find(n => n.name === table.table);
      if (!tableNode) return false;
      return childPathAllowed(tableNode, currentPath);
    });

    if (filteredTables.length === 0) return [];
    return [{ ...schema, tables: filteredTables }];
  });

  return { ...fullSchema, schemas: filteredSchemas };
}

/**
 * Apply a top-level Whitelist to a list of connections.
 * - '*' → return all connections unchanged
 * - []  → return empty list
 * - WhitelistNode[] → filter connections; connections with empty schemas are excluded
 *
 * @param connections  - Available connections (each with databaseName + schemas)
 * @param whitelist    - Whitelist to apply
 * @param currentPath  - Optional requesting path (used for childPaths filtering)
 */
export function applyWhitelistToConnections(
  connections: DatabaseWithSchema[],
  whitelist: Whitelist,
  currentPath?: string,
): DatabaseWithSchema[] {
  if (whitelist === '*') return connections;

  return connections.flatMap(conn => {
    const connNode = whitelist.find(n => n.name === conn.databaseName);
    if (!connNode) return [];

    // Check connection-level childPaths
    if (!childPathAllowed(connNode, currentPath)) return [];

    const filteredSchema = filterSchemaByWhitelistNode(
      { schemas: conn.schemas, updated_at: conn.updated_at || new Date().toISOString() },
      connNode,
      currentPath,
    );

    if (filteredSchema.schemas.length === 0) return [];

    return [{ ...conn, schemas: filteredSchema.schemas }];
  });
}

/**
 * Filter schema based on whitelist items
 * @param fullSchema - The full database schema
 * @param whitelist - Array of whitelist items
 * @param currentPath - Optional path of child context requesting filtering
 * @param contextDir - Optional directory of the context file itself (e.g. "/org" for "/org/context").
 *                     When provided, items directly in this directory always pass the childPaths check
 *                     because childPaths restricts subfolders, not the context's own level.
 */
export function filterSchemaByWhitelist(
  fullSchema: DatabaseSchema,
  whitelist: WhitelistItem[],
  currentPath?: string,
  contextDir?: string
): DatabaseSchema {
  // Filter whitelist items by childPaths BEFORE creating lookup sets
  const applicableWhitelist = whitelist.filter(item => {
    // If childPaths is undefined/null, apply to all (backward compatible)
    if (!item.childPaths) return true;
    // If currentPath not provided, include all (file-scope callers omit it)
    if (!currentPath) return true;
    // contextDir itself always passes — it sits above the childPaths restriction
    if (contextDir && currentPath === contextDir) return true;
    // Empty childPaths → nowhere
    if (item.childPaths.length === 0) return false;
    // Strict match: currentPath must be exactly a childPath or nested under one
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
 * Get whitelisted schema for a user's published version.
 *
 * With the new whitelist schema (ContextVersion.whitelist), the context loader
 * already computes fullSchema as the final exposed schema (parent offering ×
 * own whitelist). So this function simply returns fullSchema.
 *
 * The currentPath / contextDir parameters are kept for backward compatibility
 * but are no longer used for filtering — childPaths filtering now happens
 * at load time inside the context loader.
 *
 * @param contextContent - The context content with fullSchema computed by loader
 * @param userId - The user ID (unused — single published version for all users)
 * @param currentPath - Unused (kept for API compatibility)
 * @param contextDir  - Unused (kept for API compatibility)
 * @returns Array of databases with whitelisted schemas/tables only
 */
export function getWhitelistedSchemaForUser(
  contextContent: ContextContent,
  _userId: number,
  _currentPath?: string,
  _contextDir?: string
): DatabaseWithSchema[] {
  // The loader already applied the whitelist when computing fullSchema.
  // Return it directly.
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
  const inheritedDocStrings = (contextContent.fullDocs || [])
    .filter(doc => typeof doc === 'string' || doc.draft !== true)
    .map(doc => typeof doc === 'string' ? doc : doc.content);

  // Get user's published version and return its docs
  if (contextContent.versions && contextContent.versions.length > 0) {
    const publishedVersionNum = getPublishedVersionForUser(contextContent, userId);
    const publishedVersion = contextContent.versions.find(v => v.version === publishedVersionNum);

    if (publishedVersion && publishedVersion.docs) {
      // Handle DocEntry[] format (post-migration v11)
      const ownDocStrings = publishedVersion.docs
        .filter(doc => typeof doc === 'string' || doc.draft !== true)
        .map(doc => typeof doc === 'string' ? doc : doc.content);
      const allDocStrings = [...inheritedDocStrings, ...ownDocStrings].filter(Boolean);
      return allDocStrings.length > 0 ? allDocStrings.join('\n\n---\n\n') : undefined;
    }
  }

  // Legacy fallback or no own docs — return inherited only
  return inheritedDocStrings.length > 0 ? inheritedDocStrings.join('\n\n---\n\n') : undefined;
}
