/**
 * Context Loader
 * Computes fullSchema and fullDocs from parent context or connections
 * Supports versioning - each user sees their published version
 */

import { DbFile, ContextContent, DatabaseWithSchema, ContextVersion, DocEntry, MetricDef, TableAnnotation, SkillEntry } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getPublishedVersionForUser as getPublishedVersionForUserId, resolveVersionWhitelist } from '@/lib/context/context-utils';
import { CustomLoader } from './types';
import { computeSchemaFromWhitelist } from './context-loader-utils';

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
    throw new Error('Context has no versions — the context document predates the context-versioning migration and is missing migrated version data.');
  }

  // Determine which version to use for this user
  const publishedVersionNumber = getPublishedVersionForUserId(content, user.userId);
  const publishedVersion = content.versions.find(v => v.version === publishedVersionNumber);

  if (!publishedVersion) {
    throw new Error(`Published version ${publishedVersionNumber} not found in context ${file.path}`);
  }

  // Compute fullSchema, parentSchema, fullDocs, fullMetrics and fullSkills based on the published version
  const { fullSchema, parentSchema, fullDocs, fullMetrics, fullAnnotations, fullSkills } = await computeSchemaFromVersion(
    { ...publishedVersion, whitelist: resolveVersionWhitelist(publishedVersion) },
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
        parentSchema,
        fullDocs,
        fullMetrics,
        fullAnnotations,
        fullSkills
      }
    };
  } else {
    // Non-admins only see their published version (no versions array exposure)
    return {
      ...file,
      content: {
        versions: [publishedVersion],  // Only their published version
        published: { all: publishedVersionNumber },  // Hide other publish info
        skills: content.skills || [],
        fullSchema,
        parentSchema,
        fullDocs,
        fullMetrics,
        fullAnnotations,
        fullSkills
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
): Promise<{ fullSchema: DatabaseWithSchema[], parentSchema: DatabaseWithSchema[], fullDocs: DocEntry[], fullMetrics: MetricDef[], fullAnnotations: TableAnnotation[], fullSkills: SkillEntry[] }> {
  const { fullSchema, parentSchema, fullDocs, fullMetrics, fullAnnotations, fullSkills } = await computeSchemaFromWhitelist(version.whitelist, contextPath, user);

  // fullDocs/fullMetrics already include inherited values (computed in context-loader-utils)
  // Root contexts get empty inherited values (no parent to inherit from)
  // Child contexts get parent.full* + parent.own (filtered by childPaths)
  return { fullSchema, parentSchema, fullDocs, fullMetrics, fullAnnotations, fullSkills };
}
