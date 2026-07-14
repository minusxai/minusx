/**
 * Context Loader
 * Computes fullSchema and fullDocs from parent context or connections
 * Supports versioning - each user sees their published version
 */

import { DbFile, ContextContent, DatabaseWithSchema, ContextVersion, DocEntry, MetricDef, TableAnnotation, SkillEntry, TableRelationship, ViewDef, ViewProblem, VIEWS_SCHEMA } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getPublishedVersionForUser as getPublishedVersionForUserId, resolveVersionWhitelist } from '@/lib/context/context-utils';
import { CustomLoader } from './types';
import { computeSchemaFromWhitelist } from './context-loader-utils';
import { boundSchema, boundFullSchema } from '@/lib/context/schema-bounding';
import { checkViewAvailability } from '@/lib/views/integrity';

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

  // Views (inherited + this version's own) surface as ORDINARY TABLES under the
  // `_views` schema. One injection here is what makes a view work everywhere:
  // the whitelist validator accepts `_views.x`, the agent sees it, the GUI lists
  // it, and the semantic layer derives a model from its columns. Views are always
  // exposed by the context that defines or inherits them — they are curated by
  // construction, so they need no separate whitelisting.
  //
  // A view is DISABLED here when what it reads is no longer available — most
  // importantly when an ancestor has since narrowed its whitelist. That must
  // fail CLOSED: the view leaves the exposed schema (so nothing can query it,
  // and children never inherit it) and the reason is surfaced for the UI, rather
  // than the view quietly continuing to read a table the org just pulled.
  // Own views only: an ancestor's views were already checked when its own loader
  // ran, which is what makes the guarantee hold recursively without a tree crawl.
  const fullViews = computed.fullViews;
  const ownViews = publishedVersion.views || [];
  const viewProblems: ViewProblem[] = [];
  const validOwnViews = ownViews.filter((v) => {
    const reason = checkViewAvailability(v, computed.parentSchema, [...fullViews, ...ownViews]);
    if (reason) viewProblems.push({ view: v.name, reason });
    return !reason;
  });
  const allViews = [...fullViews, ...validOwnViews];
  const withViews = injectViewsAsTables(computed.fullSchema, allViews);

  // Bound the columnar schema (WITH the views already injected, so they ship with columns): keep columns when small, drop the
  // columnar bulk when huge. This is what keeps a 1963-table connection from putting ~8 MB into every
  // context load, API response, Redux store, and chat payload — the production OOM.
  //
  // fullSchema vs parentSchema differ in ONE way: fullSchema is the RESOLVED own schema that CHILD
  // contexts inherit from, so it must never lose a table (boundFullSchema = names-only, no table cap).
  // parentSchema is only the editor's available-to-whitelist menu, so it may also cap the table list.
  const fullSchema = boundFullSchema(withViews) as ContextContent['fullSchema'];
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
        fullViews,
        viewProblems,
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
        fullViews,
        viewProblems,
        fullSkills
      }
    };
  }
}

/**
 * Add each view to its connection's schema as a table under `_views`.
 * A view with no column snapshot yet (never successfully saved) still appears —
 * as a names-only table — so it is at least visible and referenceable.
 */
function injectViewsAsTables(schema: DatabaseWithSchema[], views: ViewDef[]): DatabaseWithSchema[] {
  if (views.length === 0) return schema;
  return schema.map((db) => {
    const mine = views.filter((v) => v.connection === db.databaseName);
    if (mine.length === 0) return db;
    const tables = mine.map((v) => ({ table: v.name, columns: (v.columns ?? []).map((c) => ({ ...c })) }));
    return {
      ...db,
      schemas: [...db.schemas.filter((s) => s.schema !== VIEWS_SCHEMA), { schema: VIEWS_SCHEMA, tables }],
    };
  });
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
): Promise<{ fullSchema: DatabaseWithSchema[], parentSchema: DatabaseWithSchema[], fullDocs: DocEntry[], fullMetrics: MetricDef[], fullAnnotations: TableAnnotation[], fullRelationships: TableRelationship[], fullViews: ViewDef[], fullSkills: SkillEntry[] }> {
  // fullDocs/fullMetrics already include inherited values (computed in context-loader-utils)
  // Root contexts get empty inherited values (no parent to inherit from)
  // Child contexts get parent.full* + parent.own (filtered by childPaths)
  return computeSchemaFromWhitelist(version.whitelist, contextPath, user);
}
