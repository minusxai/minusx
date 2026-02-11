import yaml from 'js-yaml';
import { WhitelistItem, ContextContent, DatabaseContext, ContextVersion } from '../types';

/**
 * Serialize multiple databases to YAML format
 */
export function serializeDatabases(databases: DatabaseContext[] | undefined): string {
  return yaml.dump({ databases: databases || [] }, {
    indent: 2,
    lineWidth: -1,
    noRefs: true
  });
}

/**
 * Parse YAML with databases array
 */
export function parseDatabasesYaml(yamlText: string): DatabaseContext[] {
  try {
    const parsed = yaml.load(yamlText) as { databases?: DatabaseContext[] };

    if (!parsed || !parsed.databases || !Array.isArray(parsed.databases)) {
      return [];
    }

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
    if (!Array.isArray(version.databases)) {
      throw new Error(`Version ${version.version}: databases must be an array`);
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

    // Validate whitelist structure in each database
    version.databases.forEach((dbContext, dbIdx) => {
      if (!Array.isArray(dbContext.whitelist)) {
        throw new Error(`Version ${version.version}, database ${dbIdx}: whitelist must be array`);
      }

      dbContext.whitelist.forEach((item, itemIdx) => {
        // Validate childPaths if present
        if (item.childPaths !== undefined) {
          if (!Array.isArray(item.childPaths)) {
            throw new Error(
              `Version ${version.version}, database ${dbIdx}, item ${itemIdx}: childPaths must be array`
            );
          }

          item.childPaths.forEach((path, pathIdx) => {
            if (typeof path !== 'string' || path.trim() === '') {
              throw new Error(
                `Version ${version.version}, database ${dbIdx}, item ${itemIdx}, path ${pathIdx}: must be non-empty string`
              );
            }
            if (!path.startsWith('/')) {
              throw new Error(
                `Version ${version.version}, database ${dbIdx}, item ${itemIdx}, path ${pathIdx}: must be absolute path (start with /)`
              );
            }
          });
        }
      });
    });
  });
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
  return content.published.all;
}

/**
 * Get published version (new cleaner name)
 */
export function getPublishedVersion(content: ContextContent): number {
  return content.published.all;
}
