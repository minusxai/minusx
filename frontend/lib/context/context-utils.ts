import yaml from 'js-yaml';
import { WhitelistItem, ContextContent, DatabaseContext, ContextVersion, Whitelist } from '../types';

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
 * Returns the most specific ancestor path from the provided list,
 * or the first path if none are ancestors.
 */
export function findNearestContextPath(
  contextPaths: string[],
  basePath: string,
): string | null {
  if (contextPaths.length === 0) return null;

  // Find all paths that are ancestors of basePath (or equal to it)
  const ancestors = contextPaths.filter((p) => basePath.startsWith(p));

  if (ancestors.length > 0) {
    // Return longest match (most specific ancestor)
    return ancestors.reduce((best, p) => (p.length > best.length ? p : best));
  }

  // No ancestor found — return first available context
  return contextPaths[0];
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
