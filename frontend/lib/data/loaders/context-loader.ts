/**
 * Context Loader
 * Computes fullSchema and fullDocs from parent context or connections
 * Supports versioning - each user sees their published version
 */

import { DbFile, ContextContent, DatabaseWithSchema, ContextVersion, DocEntry } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getPublishedVersionForUser as getPublishedVersionForUserId } from '@/lib/context/context-utils';
import { CustomLoader } from './types';
import { computeSchemaFromDatabases } from './context-loader-utils';

/**
 * Context Loader - Computes fullSchema and fullDocs based on published version
 *
 * Versioning behavior:
 *   - Admins: See all versions + metadata, fullSchema computed from their published version
 *   - Non-admins: See only their published version, no version metadata
 *
 * Root context (/org/context):
 *   - Loads all connections (connection loaders add schemas)
 *   - fullSchema = merged connection schemas
 *   - fullDocs = []
 *
 * Child context (/org/sales/context):
 *   - Loads parent context (parent's loader computes its fullSchema)
 *   - fullSchema = parent's schema filtered by parent's whitelist
 *   - fullDocs = parent's docs
 */
export const contextLoader: CustomLoader = async (file: DbFile, user: EffectiveUser, _options?) => {
  // Skip if metadata-only
  if (file.content === null) {
    return file;
  }

  const content = file.content as ContextContent;

  // After migration, all contexts should have versions
  if (!content.versions || content.versions.length === 0) {
    throw new Error('Context has no versions. Run database migration: npm run import-db -- --replace-db=y');
  }

  // Determine which version to use for this user
  const publishedVersionNumber = getPublishedVersionForUserId(content, user.userId);
  const publishedVersion = content.versions.find(v => v.version === publishedVersionNumber);

  if (!publishedVersion) {
    throw new Error(`Published version ${publishedVersionNumber} not found in context ${file.path}`);
  }

  // Compute fullSchema and fullDocs based on the published version
  const { fullSchema, fullDocs } = await computeSchemaFromVersion(
    publishedVersion,
    file.path,
    user
  );

  if (user.role === 'admin') {
    // Admins see all versions + metadata
    return {
      ...file,
      content: {
        ...content,
        fullSchema,
        fullDocs
      }
    };
  } else {
    // Non-admins only see their published version (no versions array exposure)
    return {
      ...file,
      content: {
        versions: [publishedVersion],  // Only their published version
        published: { all: publishedVersionNumber },  // Hide other publish info
        fullSchema,
        fullDocs
      }
    };
  }
};


/**
 * Compute fullSchema and fullDocs from a specific version
 * This is where parent context inheritance happens - parent's published version
 * determines what schema is available to children
 */
async function computeSchemaFromVersion(
  version: ContextVersion,
  contextPath: string,
  user: EffectiveUser
): Promise<{ fullSchema: DatabaseWithSchema[], fullDocs: DocEntry[] }> {
  const { fullSchema, fullDocs } = await computeSchemaFromDatabases(version.databases, contextPath, user);

  // fullDocs already includes inherited docs (computed in context-loader-utils)
  // Root contexts get empty fullDocs (no parent to inherit from)
  // Child contexts get parent.fullDocs + parent.docs (filtered by childPaths)
  return { fullSchema, fullDocs };
}

