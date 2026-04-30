import yaml from 'js-yaml';
import { WhitelistItem, ContextContent, DatabaseContext, ContextVersion, SkillEntry, Whitelist, WhitelistNode } from '../types';

export function mergeSkillsByName(...skillGroups: SkillEntry[][]): SkillEntry[] {
  const byName = new Map<string, SkillEntry>();
  for (const skills of skillGroups) {
    for (const skill of skills) {
      if (!skill.name) continue;
      byName.delete(skill.name);
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()];
}

/**
 * Serialize databases (or '*') to YAML format.
 * '*' serializes as `databases: '*'` to preserve the "expose all" semantic.
 */
export function serializeDatabases(databases: DatabaseContext[] | '*' | undefined): string {
  if (databases === '*') {
    return yaml.dump({ databases: '*' }, { indent: 2, lineWidth: -1, noRefs: true });
  }
  return yaml.dump({ databases: databases || [] }, {
    indent: 2,
    lineWidth: -1,
    noRefs: true
  });
}

/**
 * Parse YAML with databases array (or '*').
 * Returns '*' when the YAML contains `databases: '*'`.
 */
export function parseDatabasesYaml(yamlText: string): DatabaseContext[] | '*' {
  try {
    const parsed = yaml.load(yamlText) as { databases?: DatabaseContext[] | '*' };

    if (!parsed) return [];
    if (parsed.databases === '*') return '*';
    if (!parsed.databases || !Array.isArray(parsed.databases)) return [];

    return parsed.databases;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`YAML parse error: ${error.message}`);
    }
    throw new Error('Failed to parse YAML');
  }
}

/**
 * Validate context versions structure
 * Throws error if invalid
 */
export function validateContextVersions(content: ContextContent): void {
  if (!content.versions || content.versions.length === 0) {
    throw new Error('Context must have at least one version');
  }

  // Ensure version numbers are unique and positive
  const versionNumbers = content.versions.map(v => v.version);
  const uniqueVersions = new Set(versionNumbers);
  if (uniqueVersions.size !== versionNumbers.length) {
    throw new Error('Version numbers must be unique');
  }

  if (versionNumbers.some(v => v < 1 || !Number.isInteger(v))) {
    throw new Error('Version numbers must be positive integers');
  }

  // Ensure published version exists
  const exists = content.versions.some(v => v.version === content.published.all);
  if (!exists) {
    throw new Error(`Published version ${content.published.all} does not exist`);
  }

  // Validate each version structure
  content.versions.forEach((version, index) => {
    if (typeof version.version !== 'number') {
      throw new Error(`Version ${index}: version number must be a number`);
    }
    // whitelist must be '*' or an array
    const wl = version.whitelist;
    if (wl !== '*' && !Array.isArray(wl)) {
      throw new Error(`Version ${version.version}: whitelist must be '*' or an array`);
    }
    if (!Array.isArray(version.docs)) {
      throw new Error(`Version ${version.version}: docs must be an array`);
    }
    if (!version.createdAt || typeof version.createdAt !== 'string') {
      throw new Error(`Version ${version.version}: createdAt is required and must be a string`);
    }
    if (typeof version.createdBy !== 'number') {
      throw new Error(`Version ${version.version}: createdBy must be a number`);
    }
  });
}

/**
 * Create default context content for a new folder.
 * The default context exposes all connections ('*') and has no documentation.
 *
 * @param userId - ID of the user creating the context
 */
export function makeDefaultContextContent(userId: number): ContextContent {
  const now = new Date().toISOString();
  return {
    versions: [{
      version: 1,
      whitelist: '*' as Whitelist,
      docs: [],
      createdAt: now,
      createdBy: userId,
      description: 'Default context',
    }],
    published: { all: 1 },
  };
}

/**
 * Check if a version can be deleted
 * Returns true if version can be deleted, false otherwise
 */
export function canDeleteVersion(content: ContextContent, version: number): boolean {
  // Cannot delete if only one version
  if (!content.versions || content.versions.length <= 1) {
    return false;
  }

  // Cannot delete if published
  if (content.published.all === version) {
    return false;
  }

  return true;
}

/**
 * Find the nearest context path to a given base path.
 *
 * Context files live at paths like /org/context or /org/sales/context.
 * The folder a context "serves" is its parent directory.
 * We find the context whose serving folder is the deepest ancestor of basePath,
 * breaking ties alphabetically for a stable, deterministic result.
 */
export function findNearestContextPath(
  contextPaths: string[],
  basePath: string,
): string | null {
  if (contextPaths.length === 0) return null;

  // For each context file at /a/b/ctx-name, the folder it serves is /a/b.
  // Collect candidates whose serving folder is an ancestor of (or equal to) basePath.
  const candidates: { path: string; depth: number }[] = [];
  for (const p of contextPaths) {
    const folder = p.substring(0, p.lastIndexOf('/')) || '/';
    if (basePath === folder || basePath.startsWith(folder + '/')) {
      candidates.push({ path: p, depth: folder.length });
    }
  }

  if (candidates.length > 0) {
    const maxDepth = Math.max(...candidates.map((c) => c.depth));
    const deepest = candidates.filter((c) => c.depth === maxDepth);
    // Stable tie-break: alphabetical (so /org/context beats /org/eval-context)
    deepest.sort((a, b) => a.path.localeCompare(b.path));
    return deepest[0].path;
  }

  // No ancestor found — return alphabetically first for stability
  return [...contextPaths].sort((a, b) => a.localeCompare(b))[0];
}

/**
 * Get next available version number
 * Returns max version + 1
 */
export function getNextVersionNumber(content: ContextContent): number {
  if (!content.versions || content.versions.length === 0) {
    return 1;
  }
  return Math.max(...content.versions.map(v => v.version)) + 1;
}

/**
 * Get published version (applies to all users)
 * Note: userId parameter kept for backward compatibility but not used
 */
export function getPublishedVersionForUser(content: ContextContent, _userId: number): number {
  return content.published?.all ?? 1;
}

/**
 * Get published version (new cleaner name)
 */
export function getPublishedVersion(content: ContextContent): number {
  return content.published?.all ?? 1;
}

/**
 * Convert a DatabaseContext[] (old format) to WhitelistNode[] (new format).
 *
 * Semantic mapping:
 *   - dbCtx.whitelist === []  → children: []        (expose nothing)
 *   - schema-only items      → schema node, children: undefined (expose all tables)
 *   - table items            → grouped under their schema node with explicit children
 *   - mixed schema+table     → table children take precedence (explicit list)
 *
 * IMPORTANT: empty whitelist → children: [] (NOT undefined).
 *   children: undefined = "expose all tables in this schema/connection"
 *   children: []        = "expose nothing from this schema/connection"
 */
export function convertDatabaseContextToWhitelist(legacyDbs: DatabaseContext[]): WhitelistNode[] {
  return legacyDbs.map((dbCtx) => {
    const connNode: WhitelistNode = { name: dbCtx.databaseName, type: 'connection' };

    if (!dbCtx.whitelist || dbCtx.whitelist.length === 0) {
      connNode.children = [];  // empty whitelist = expose nothing
      return connNode;
    }

    // Group items by schema using a Map to handle mixed schema+table entries correctly
    const schemaMap = new Map<string, { node: WhitelistNode; tables: WhitelistNode[] }>();

    for (const item of dbCtx.whitelist) {
      if (item.type === 'schema') {
        if (!schemaMap.has(item.name)) {
          schemaMap.set(item.name, {
            node: { name: item.name, type: 'schema', childPaths: item.childPaths },
            tables: []
          });
        }
      } else if (item.type === 'table' && item.schema) {
        if (!schemaMap.has(item.schema)) {
          schemaMap.set(item.schema, { node: { name: item.schema, type: 'schema' }, tables: [] });
        }
        schemaMap.get(item.schema)!.tables.push({
          name: item.name,
          type: 'table',
          childPaths: item.childPaths
        });
      }
    }

    connNode.children = Array.from(schemaMap.values()).map(({ node, tables }) => {
      if (tables.length > 0) {
        // Explicit table list — schema node gets explicit children
        return { ...node, children: tables };
      }
      // Schema listed without table restrictions → expose all tables (children: undefined)
      return node;
    });

    return connNode;
  });
}

/**
 * Resolve the whitelist from a ContextVersion, handling backward compatibility.
 *
 * Older data stored the whitelist as `version.databases: DatabaseContext[]` before the
 * migration to `version.whitelist: Whitelist`. This function reads whichever field is
 * present so the context loader and editor work correctly with un-migrated data.
 */
export function resolveVersionWhitelist(version: ContextVersion): Whitelist {
  // New format: version.whitelist is set
  if (version.whitelist !== undefined) {
    return version.whitelist;
  }

  // Backward compat: old data stored whitelist inside version.databases
  const legacyDbs = (version as any).databases as DatabaseContext[] | '*' | undefined;
  if (!legacyDbs) return [];
  if (legacyDbs === '*') return '*';
  return convertDatabaseContextToWhitelist(legacyDbs);
}
