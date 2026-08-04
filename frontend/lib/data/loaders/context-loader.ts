/**
 * Context Loader
 * Computes fullSchema and fullDocs from parent context or connections
 * Supports versioning - each user sees their published version
 */

import { DbFile, ContextContent, DatabaseWithSchema, ContextVersion, ViewDef, ViewProblem, VIEWS_SCHEMA } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getPublishedVersionForUser as getPublishedVersionForUserId, resolveVersionWhitelist } from '@/lib/context/context-utils';
import { CustomLoader } from './types';
import { computeSchemaFromWhitelist, type ComputedContextSchema } from './context-loader-utils';
import { boundSchema, boundFullSchema } from '@/lib/context/schema-bounding';
import { checkViewAvailability } from '@/lib/views/integrity';
import { viewsAsSchemaTables } from '@/lib/types/views';

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

export const contextLoader: CustomLoader = async (file: DbFile, user: EffectiveUser, options?) => {
  // Skip if metadata-only
  if (file.content === null) {
    return file;
  }
  // Raw-content mode (e.g. file search): serve stored content without the
  // fullSchema computation, which loads every connection and THROWS on
  // unmigrated (version-less) contexts.
  if (options?.skipEnrichment) {
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
  const { fullDocs, fullMetrics, fullAnnotations, fullSkills, fullAgents } = computed;

  // Authored semantic models inherit like metrics: fullSemanticModels is
  // INHERITED-ONLY (ancestor's), mirroring fullMetrics — the version's own
  // models stay on the version, or the editor would show every own model a
  // second time tagged "inherited". (DERIVED draft models are separate:
  // lib/semantic/models.server.ts.)
  const fullSemanticModels = computed.fullSemanticModels;
  // What the parent OFFERED, before this context's own exclusions — the editor
  // needs it to render a declined model as an unchecked row (peer of parentSchema).
  const { parentViews, parentSemanticModels } = computed;

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
        fullViews,
        fullSemanticModels,
        parentViews,
        parentSemanticModels,
        viewProblems,
        fullSkills,
        fullAgents
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
        agents: content.agents || [],
        fullSchema,
        parentSchema,
        fullDocs,
        fullMetrics,
        fullAnnotations,
        fullViews,
        fullSemanticModels,
        parentViews,
        parentSemanticModels,
        viewProblems,
        fullSkills,
        fullAgents
      }
    };
  }
}

/**
 * Add each view to its connection's schema as a table under `_views`.
 * The table projection (OFF-view and column-whitelist handling) is
 * `viewsAsSchemaTables`, shared with the production SearchDBSchema tool.
 *
 * A connection with NO whitelisted real tables is dropped by the whitelist fold
 * (`applyWhitelistToConnections`), so decorating only what survived would delete
 * the views along with the tables they exist to hide — and "expose the clean
 * view and nothing else" is the canonical curated setup, not an edge case. Such
 * a connection is therefore re-added carrying its `_views` schema alone.
 */
function injectViewsAsTables(schema: DatabaseWithSchema[], views: ViewDef[]): DatabaseWithSchema[] {
  // Strip FIRST, unconditionally. A child inherits its parent's `fullSchema`,
  // which already carries the parent's injected `_views` — and to the whitelist
  // fold that is an ordinary schema, so it rode down the tree untouched. A child
  // that DECLINED a view still had it in its whitelisted schema, and only view
  // resolution stopped the query (a puzzling "unknown view" rather than a
  // refusal). Each context injects its OWN views and inherits none as tables.
  const present = new Set(schema.map((db) => db.databaseName));
  const decorated = schema.map((db) => {
    const rest = db.schemas.filter((s) => s.schema !== VIEWS_SCHEMA);
    if (!views.some((v) => v.connection === db.databaseName)) return { ...db, schemas: rest };
    const tables = viewsAsSchemaTables(views, db.databaseName);
    // Every view on this connection turned OFF leaves no `_views` schema at all,
    // rather than an empty one — "not a table anywhere" should read the same to
    // the picker, the agent's schema and the whitelist validator.
    return { ...db, schemas: tables.length > 0 ? [...rest, { schema: VIEWS_SCHEMA, tables }] : rest };
  });
  const viewsOnly = [...new Set(views.map((v) => v.connection))]
    .filter((connection) => !present.has(connection))
    .map((connection) => ({ databaseName: connection, schemas: [{ schema: VIEWS_SCHEMA, tables: viewsAsSchemaTables(views, connection) }] }))
    .filter((db) => db.schemas[0].tables.length > 0);
  return viewsOnly.length > 0 ? [...decorated, ...viewsOnly] : decorated;
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
): Promise<ComputedContextSchema> {
  // fullDocs/fullMetrics already include inherited values (computed in context-loader-utils)
  // Root contexts get empty inherited values (no parent to inherit from)
  // Child contexts get parent.full* + parent.own (filtered by childPaths), minus
  // whatever this version does not take (viewWhitelist / semanticModelWhitelist)
  return computeSchemaFromWhitelist(version, contextPath, user);
}
