/**
 * Shared schema filtering logic
 * Used by both client-side (useContext hook) and server-side (ContextHelpers)
 */
import { DatabaseSchema, WhitelistItem, ContextContent, DatabaseWithSchema, Whitelist, WhitelistNode, DocEntry, MetricDef, TableAnnotation } from '../types';
import { getPublishedVersionForUser } from '../context/context-utils';

/**
 * Build an agent-facing "Schema Notes" markdown section from context-authored
 * table/column descriptions and metrics. Returns undefined when there's nothing
 * to say. (Profiled column descriptions/stats reach the agent separately via the
 * SearchDBSchema tool; this surfaces the editorial context layer + metrics.)
 */
function buildSchemaNotes(annotations: TableAnnotation[], metrics: MetricDef[]): string | undefined {
  const lines: string[] = [];

  const annLines = annotations.flatMap((a) => {
    const cols = (a.columns || []).filter((c) => c.description);
    if (!a.description && cols.length === 0) return [];
    const head = `- ${a.schema}.${a.table}${a.description ? ` — ${a.description}` : ''}`;
    return [head, ...cols.map((c) => `  - ${c.name}: ${c.description}`)];
  });
  if (annLines.length > 0) lines.push('### Tables & Columns', 'Note: These descriptions were specially noted by the context authors.', ...annLines);

  const metricLines = metrics.map((m) => {
    const loc = m.schema && m.table ? ` [${m.schema}.${m.table}]` : '';
    const desc = m.description ? ` — ${m.description}` : '';
    const sql = m.sql ? `\n  \`\`\`sql\n  ${m.sql.replace(/\n/g, '\n  ')}\n  \`\`\`` : '';
    return `- ${m.name}${loc}${desc}${sql}`;
  });
  if (metricLines.length > 0) lines.push('### Metrics', 'Note: These metrics were specially noted by the context authors. Pay attention to the SQL definitions, if available.', ...metricLines);

  return lines.length > 0 ? `## Schema Notes\n\n${lines.join('\n')}` : undefined;
}

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
 * Serialize a doc entry to its agent-facing string, prepending the optional
 * title/description when present (both default to absent and are skipped).
 */
function docEntryToString(doc: DocEntry | string): string {
  if (typeof doc === 'string') return doc;
  const header = [
    doc.title ? `# ${doc.title}` : null,
    doc.description ? doc.description : null,
  ].filter(Boolean).join('\n\n');
  return header ? `${header}\n\n${doc.content}` : doc.content;
}

/**
 * Resolve the user's published version + the merged non-draft doc list (inherited
 * docs first, then own docs) and the inline Schema Notes section. Shared by the
 * full serializer (getDocumentationForUser) and the lazy resolver
 * (resolveContextDocs).
 */
function collectContextDocs(contextContent: ContextContent, userId: number): {
  docs: (DocEntry | string)[];
  schemaNotes: string | undefined;
} {
  // Inherited docs (fullDocs) — already filtered by childPaths at load time.
  const inheritedDocs = (contextContent.fullDocs || [])
    .filter(doc => typeof doc === 'string' || doc.draft !== true);

  const publishedVersion = contextContent.versions && contextContent.versions.length > 0
    ? contextContent.versions.find(v => v.version === getPublishedVersionForUser(contextContent, userId))
    : undefined;

  const ownDocs = (publishedVersion?.docs || [])
    .filter(doc => typeof doc === 'string' || doc.draft !== true);

  // Schema Notes: context-authored descriptions + metrics (own + inherited).
  const annotations = [...(contextContent.fullAnnotations || []), ...(publishedVersion?.annotations || [])];
  const metrics = [...(contextContent.fullMetrics || []), ...(publishedVersion?.metrics || [])];
  const schemaNotes = buildSchemaNotes(annotations, metrics);

  return { docs: [...inheritedDocs, ...ownDocs], schemaNotes };
}

/**
 * Get documentation for a user's published version — FULL serialization of every
 * (non-draft) doc inline. Used by benchmark/headless prompt builders that don't
 * advertise the LoadContext tool. Interactive chat uses resolveContextDocs instead.
 *
 * @param contextContent - The context content with versions
 * @param userId - The user ID to get the published version for
 * @returns Documentation string or undefined
 */
export function getDocumentationForUser(
  contextContent: ContextContent,
  userId: number
): string | undefined {
  const { docs, schemaNotes } = collectContextDocs(contextContent, userId);
  const allDocStrings = [...docs.map(docEntryToString), schemaNotes].filter(Boolean);
  return allDocStrings.length > 0 ? allDocStrings.join('\n\n---\n\n') : undefined;
}

/**
 * A lazy-loadable context doc. `title`/`description` are the human-facing fields
 * shown to the agent so it can judge relevance; `key` is the stable slug the agent
 * passes to LoadContext to fetch the full `content`.
 */
export interface ContextDocCatalogEntry {
  key: string;
  title: string;
  description?: string;
  content: string;
}

/**
 * Slugify a doc title into a stable, easy-to-pass key: lowercased, non-alphanumeric
 * runs collapsed to underscores, trimmed. Returns '' for an empty/punctuation-only
 * title (caller assigns a fallback).
 */
function slugifyDocKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Derive a title + description from a doc's body, for legacy docs saved before
 * title/description were required: first non-empty line → title (markdown heading
 * markers stripped), next two non-empty lines → description. New docs are required
 * to carry an explicit title + description (enforced in the context editor), so
 * this only fires for older data.
 */
export function deriveDocMeta(content: string): { title: string; description: string } {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const title = lines[0] ? lines[0].replace(/^#+\s*/, '').trim() : '';
  const description = lines.slice(1, 3).join(' ');
  return { title, description };
}

/** Split of a context's docs into what's always sent vs. lazily loadable. */
export interface ResolvedContextDocs {
  /** Always-inline string: string docs + alwaysInclude docs + Schema Notes. */
  inline: string;
  /** Catalog of lazy docs (`- "key" — description` lines); '' when there are none. */
  catalog: string;
  /** Lazy docs with full content, resolved on demand by the LoadContext tool. */
  library: ContextDocCatalogEntry[];
}

/**
 * Resolve a context's docs for the interactive chat path: inline only the docs
 * that must always be present (alwaysInclude docs) plus Schema Notes; every other
 * doc becomes a title+description catalog entry whose full content is fetched on
 * demand via the LoadContext tool. Docs without an explicit title/description fall
 * back to one derived from their body (see deriveDocMeta) so legacy data stays
 * loadable.
 */
export function resolveContextDocs(
  contextContent: ContextContent,
  userId: number
): ResolvedContextDocs {
  const { docs, schemaNotes } = collectContextDocs(contextContent, userId);

  const inlineStrings: string[] = [];
  const library: ContextDocCatalogEntry[] = [];
  const usedKeys = new Set<string>();
  let fallbackCount = 0;

  for (const doc of docs) {
    // alwaysInclude docs (and bare string docs, which are pinned by definition)
    // stay inline every turn.
    if (typeof doc === 'string' || doc.alwaysInclude === true) {
      inlineStrings.push(docEntryToString(doc));
      continue;
    }

    // Lazy doc — prefer the explicit title/description, deriving from the body
    // only when one is missing (legacy docs).
    const content = doc.content;
    let title = doc.title?.trim() ?? '';
    let description = doc.description?.trim() ?? '';
    if (!title || !description) {
      const derived = deriveDocMeta(content);
      if (!title) title = derived.title;
      if (!description) description = derived.description;
    }
    if (!title) title = `Document ${++fallbackCount}`;

    // The key is a stable slug derived from the title; the agent sees the title
    // (+ description) for relevance and passes the key to LoadContext.
    const baseKey = slugifyDocKey(title) || `document_${++fallbackCount}`;
    let key = baseKey;
    for (let n = 2; usedKeys.has(key); n++) key = `${baseKey}_${n}`;
    usedKeys.add(key);
    library.push({ key, title, description: description || undefined, content });
  }

  const inline = [...inlineStrings, schemaNotes].filter(Boolean).join('\n\n---\n\n');
  // Each catalog line: the key to pass, then the human title + description.
  const catalog = library
    .map((d) => `  - \`"${d.key}"\` — ${d.title}${d.description ? `: ${d.description}` : ''}`)
    .join('\n');

  return { inline, catalog, library };
}
