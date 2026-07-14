/**
 * Context Loader
 * Computes fullSchema and fullDocs from parent context or connections
 * Supports versioning - each user sees their published version
 */

import { DbFile, ContextContent, DatabaseWithSchema, ContextVersion, DocEntry, MetricDef, TableAnnotation, SkillEntry, TableRelationship } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getPublishedVersionForUser as getPublishedVersionForUserId, resolveVersionWhitelist } from '@/lib/context/context-utils';
import { CustomLoader } from './types';
import { computeSchemaFromWhitelist } from './context-loader-utils';
import { boundSchema, boundFullSchema } from '@/lib/context/schema-bounding';

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
// Concurrent-load de-duplication. The context loader recomputes the full schema (loading ALL
// connections) on every call; under production concurrency, N simultaneous loads of the same context
// each allocate the multi-MB schema independently — a primary OOM driver. Like the connection loader's
// inflightRefreshes, share one in-flight computation across concurrent callers. Keyed by file + user +
// mode (the published version + whitelist resolution depend on the user). The entry is removed when
// the promise settles, so it only ever coalesces TRULY concurrent loads — never serves a stale result.
// eslint-disable-next-line no-restricted-syntax -- server-side per-process request coalescing; entries are short-lived (deleted on settle)
const inflightContextLoads = new Map<string, Promise<DbFile>>();

export const contextLoader: CustomLoader = async (file: DbFile, user: EffectiveUser, _options?) => {
  // Skip if metadata-only
  if (file.content === null) {
    return file;
  }
  const key = `${file.id}:${user.userId}:${user.mode}`;
  const existing = inflightContextLoads.get(key);
  if (existing) return existing;
  const loading = computeContextSchema(file, user).finally(() => inflightContextLoads.delete(key));
  inflightContextLoads.set(key, loading);
  return loading;
};

async function computeContextSchema(file: DbFile, user: EffectiveUser): Promise<DbFile> {
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
  const computed = await computeSchemaFromVersion(
    { ...publishedVersion, whitelist: resolveVersionWhitelist(publishedVersion) },
    file.path,
    user
  );

  // Bound the columnar schema before it's stored/serialized/shipped: keep columns when small, drop the
  // columnar bulk when huge. This is what keeps a 1963-table connection from putting ~8 MB into every
  // context load, API response, Redux store, and chat payload — the production OOM.
  //
  // fullSchema vs parentSchema differ in ONE way: fullSchema is the RESOLVED own schema that CHILD
  // contexts inherit from, so it must never lose a table (boundFullSchema = names-only, no table cap).
  // parentSchema is only the editor's available-to-whitelist menu, so it may also cap the table list.
  const fullSchema = boundFullSchema(computed.fullSchema) as ContextContent['fullSchema'];
  const parentSchema = boundSchema(computed.parentSchema) as ContextContent['parentSchema'];
  const { fullDocs, fullMetrics, fullAnnotations, fullSkills } = computed;

  // Declared relationships inherit like metrics: fullRelationships is
  // INHERITED-ONLY (ancestor's), mirroring fullMetrics — the version's own
  // relationships stay on the version, or the editor would show every own
  // relationship a second time tagged "inherited". Semantic MODELS are NOT
  // computed here: they derive on demand (lib/semantic/models.server.ts).
  const fullRelationships = computed.fullRelationships;

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
        fullRelationships,
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
        fullRelationships,
        fullSkills
      }
    };
  }
}


/**
 * Compute fullSchema and fullDocs from a specific version
 * This is where parent context inheritance happens - parent's published version
 * determines what schema is available to children
 */
async function computeSchemaFromVersion(
  version: ContextVersion,
  contextPath: string,
  user: EffectiveUser
): Promise<{ fullSchema: DatabaseWithSchema[], parentSchema: DatabaseWithSchema[], fullDocs: DocEntry[], fullMetrics: MetricDef[], fullAnnotations: TableAnnotation[], fullRelationships: TableRelationship[], fullSkills: SkillEntry[] }> {
  // fullDocs/fullMetrics already include inherited values (computed in context-loader-utils)
  // Root contexts get empty inherited values (no parent to inherit from)
  // Child contexts get parent.full* + parent.own (filtered by childPaths)
  return computeSchemaFromWhitelist(version.whitelist, contextPath, user);
}
