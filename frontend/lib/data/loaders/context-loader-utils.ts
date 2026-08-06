/**
 * Context Loader Utilities
 * Reusable functions for computing context schemas
 * Used by both context loader and file template generation
 */

import { DatabaseWithSchema, ContextContent, ContextVersion, DocEntry, MetricDef, TableAnnotation, SkillEntry, AgentEntry, ViewDef, SemanticModelV2 } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { applyWhitelistToConnections, appliesToChildPath, resolveChildPath } from '@/lib/sql/schema-filter';
import { resolvePath } from '@/lib/mode/path-resolver';
import { getPublishedVersionForUser as getPublishedVersionForUserId, mergeByName, mergeSkillsByName } from '@/lib/context/context-utils';
import { applyNameWhitelist } from '@/lib/context/name-whitelist';

/** Keep only the entries whose `childPaths` reach `currentPath`. */
function inheritedBy<T extends { childPaths?: string[] | null }>(entries: T[], currentPath: string): T[] {
  return entries.filter((e) => appliesToChildPath(e.childPaths, currentPath));
}

/**
 * Copy entries with their `childPaths` resolved to ABSOLUTE paths against the
 * authoring context's folder. Authored entries store childPaths relative to
 * that folder; the computed plane (`fullDocs`/`fullViews`/`fullSemanticModels`)
 * carries them through further inheritance hops, where the authoring folder is
 * no longer in hand — so entries are absolutized exactly once, at the boundary
 * where an authored version is lifted into the computed plane. Computed fields
 * are stripped on save, so the absolute copies never reach authored storage.
 */
function withAbsoluteChildPaths<T extends { childPaths?: string[] | null }>(entries: T[], baseDir: string): T[] {
  return entries.map((e) =>
    e.childPaths && e.childPaths.length > 0
      ? { ...e, childPaths: e.childPaths.map((cp) => resolveChildPath(cp, baseDir)) }
      : e
  );
}

/**
 * What the inheritance computation needs off a context version: the table
 * whitelist it offers downward, plus its selections out of what it inherits.
 */
export type InheritanceSource = Pick<ContextVersion, 'whitelist' | 'viewWhitelist' | 'semanticModelWhitelist'>;

/** Everything a context inherits + resolves, as computed from its own version. */
export interface ComputedContextSchema {
  fullSchema: DatabaseWithSchema[];
  parentSchema: DatabaseWithSchema[];
  fullDocs: DocEntry[];
  fullMetrics: MetricDef[];
  fullAnnotations: TableAnnotation[];
  /** Inherited data models ON OFFER (childPaths applied, own whitelist NOT). */
  parentViews: ViewDef[];
  /** Inherited data models TAKEN (`parentViews` × this version's viewWhitelist). */
  fullViews: ViewDef[];
  /** Inherited semantic models ON OFFER (childPaths applied, whitelist NOT). */
  parentSemanticModels: SemanticModelV2[];
  /** Inherited semantic models TAKEN (`parentSemanticModels` × the whitelist). */
  fullSemanticModels: SemanticModelV2[];
  fullSkills: SkillEntry[];
  fullAgents: AgentEntry[];
}

const EMPTY_COMPUTED: ComputedContextSchema = {
  fullSchema: [], parentSchema: [], fullDocs: [], fullMetrics: [], fullAnnotations: [],
  parentViews: [], fullViews: [], parentSemanticModels: [], fullSemanticModels: [], fullSkills: [],
  fullAgents: [],
};

/**
 * Compute fullSchema and fullDocs from a Whitelist value and the context path.
 *
 * The entry-point for the context loader. `whitelist` is the tree format
 * ('*' | WhitelistNode[]).
 *
 * Flow:
 *   Root context (pathSegments.length === 2, e.g. /org/context):
 *     - Load all available connections
 *     - Apply own whitelist to produce fullSchema
 *
 *   Child context (pathSegments.length > 2):
 *     - Load nearest ancestor context (triggers its loader recursively)
 *     - Apply ancestor's published-version whitelist WITH child's contextDir
 *       to ancestor's fullSchema → "parent offering" (respects childPaths)
 *     - Apply own whitelist to the parent offering → fullSchema
 *
 * @param version     - The context's own version: whitelist it offers + what it declines
 * @param contextPath - Full path to context file (e.g., /org/sales/context)
 * @param user        - Effective user for permissions
 */
export async function computeSchemaFromWhitelist(
  version: InheritanceSource,
  contextPath: string,
  user: EffectiveUser
): Promise<ComputedContextSchema> {
  const { whitelist } = version;
  const contextDir = contextPath.substring(0, contextPath.lastIndexOf('/')) || '/';
  const pathSegments = contextPath.split('/').filter(Boolean);
  const isRoot = pathSegments.length === 2; // e.g., /org/context

  if (isRoot) {
    // Root: Load all connections and apply own whitelist
    const allConnections = await loadAllConnectionsAsSchema(user);

    // Apply own whitelist (no currentPath for root — childPaths has no effect at root level)
    const fullSchema = applyWhitelistToConnections(allConnections, whitelist);
    // parentSchema for root = all connections (what is available to select from)
    return { ...EMPTY_COMPUTED, fullSchema, parentSchema: allConnections };
  }

  // Child: Find nearest ancestor context
  const { data: allContexts } = await FilesAPI.getFiles(
    { paths: ['/'], type: 'context', depth: -1 },
    user
  );

  const ancestorContext = findNearestAncestorContext(contextPath, allContexts);

  if (!ancestorContext) {
    // No ancestor found — nothing to inherit
    return EMPTY_COMPUTED;
  }

  // Load ancestor (triggers its own loader recursively)
  const { data: loadedAncestors } = await FilesAPI.loadFiles([ancestorContext.id], user);
  const ancestorContent = loadedAncestors[0].content as ContextContent;

  // Get ancestor's published version to access its whitelist (with childPaths)
  const publishedVersionNum = getPublishedVersionForUserId(ancestorContent, user.userId);
  const publishedVersion = ancestorContent.versions?.find(
    (v) => v.version === publishedVersionNum
  );

  if (!publishedVersion) {
    return EMPTY_COMPUTED;
  }

  // The folder the ancestor's authored entries resolve their relative
  // childPaths against.
  const ancestorDir = ancestorContext.path.substring(0, ancestorContext.path.lastIndexOf('/')) || '/';

  // The ancestor's fullSchema is what the ancestor exposes (already filtered by its own whitelist).
  // Apply the ancestor's whitelist WITH currentPath = this context's directory to filter
  // by childPaths restrictions (tables/schemas restricted to specific sub-paths).
  const ancestorFullSchema: DatabaseWithSchema[] = ancestorContent.fullSchema || [];
  const parentOffering = applyWhitelistToConnections(
    ancestorFullSchema,
    publishedVersion.whitelist,
    contextDir,
    ancestorDir
  );

  // Apply own whitelist to the parent's offering
  const fullSchema = applyWhitelistToConnections(parentOffering, whitelist);

  // Accumulate parent's fullDocs + parent's own docs, both filtered by childPaths.
  // The ancestor's AUTHORED entries are absolutized here (their relative
  // childPaths resolve against the ancestor's folder); its full* entries were
  // absolutized when its own loader lifted them, so they pass through as-is.
  const parentFullDocs = inheritedBy(ancestorContent.fullDocs || [], contextDir);
  const parentOwnDocs = inheritedBy(withAbsoluteChildPaths(publishedVersion.docs || [], ancestorDir), contextDir);
  const fullDocs = [...parentFullDocs, ...parentOwnDocs];
  const fullSkills = mergeSkillsByName(ancestorContent.fullSkills || [], ancestorContent.skills || []);
  const fullAgents = mergeByName(ancestorContent.fullAgents || [], ancestorContent.agents || []);

  // Accumulate inherited metrics (parent's inherited + parent's own).
  const fullMetrics = [...(ancestorContent.fullMetrics || []), ...(publishedVersion.metrics || [])];
  const fullAnnotations = [...(ancestorContent.fullAnnotations || []), ...(publishedVersion.annotations || [])];
  // Views inherit the same way — a child sees every view its ancestors define,
  // MINUS any the ancestor's own loader disabled (its `viewProblems`). That is
  // what makes the guarantee recursive: each level validates only its own views,
  // and refuses to pass on what it had to disable.
  const ancestorBroken = new Set<string>(
    (ancestorContent.viewProblems ?? []).map((p) => p.view),
  );
  //
  // Both halves of the inheritance decision apply here, in this order:
  //   1. `childPaths` on each model — the PARENT's choice of who receives it,
  //      re-checked at every level so a grandparent's restriction keeps binding
  //      (same shape as docs above, same predicate as whitelist nodes).
  //   2. `viewWhitelist` / `semanticModelWhitelist` on THIS version — the child's
  //      selection out of that, the exact analogue of re-selecting tables out of
  //      `parentSchema` (and absent = '*' = take it all, like a fresh context).
  // What survives both is what cascades: a model this context did not take is
  // absent from `fullViews`, so the next level down never sees it either.
  const parentViews = inheritedBy([
    ...(ancestorContent.fullViews || []),
    ...withAbsoluteChildPaths((publishedVersion.views || []).filter((v) => !ancestorBroken.has(v.name)), ancestorDir),
  ], contextDir);
  const fullViews = applyNameWhitelist(parentViews, version.viewWhitelist);
  // Authored semantic models inherit exactly like views (ancestor's inherited +
  // ancestor's own published models); validity gating happens at save, not load.
  const parentSemanticModels = inheritedBy([
    ...(ancestorContent.fullSemanticModels || []),
    ...withAbsoluteChildPaths(publishedVersion.semanticModels || [], ancestorDir),
  ], contextDir);
  const fullSemanticModels = applyNameWhitelist(parentSemanticModels, version.semanticModelWhitelist);

  // parentOffering = what the parent makes available to this context (before own whitelist)
  return {
    fullSchema, parentSchema: parentOffering, fullDocs, fullMetrics, fullAnnotations,
    parentViews, fullViews, parentSemanticModels, fullSemanticModels, fullSkills, fullAgents,
  };
}

/**
 * Load all available connections and return as DatabaseWithSchema[].
 */
async function loadAllConnectionsAsSchema(user: EffectiveUser): Promise<DatabaseWithSchema[]> {
  const databaseFolder = resolvePath(user.mode, '/database');
  const { data: connections } = await FilesAPI.getFiles(
    { paths: [databaseFolder], type: 'connection', depth: 1 },
    user
  );

  const { data: loadedConnections } = await FilesAPI.loadFiles(
    connections.map(c => c.id),
    user
  );

  return loadedConnections.map(conn => ({
    databaseName: conn.name,
    schemas: (conn.content as any)?.schema?.schemas || [],
    updated_at: (conn.content as any)?.schema?.updated_at,
  }));
}

/**
 * Find nearest ancestor context by walking up the directory tree
 * @param currentPath - Full path to current context file
 * @param allContexts - Array of all context file metadata in the system
 * @returns Nearest ancestor context file metadata or null if none found
 */
function findNearestAncestorContext(currentPath: string, allContexts: any[]): any | null {
  const segments = currentPath.split('/').filter(Boolean);
  segments.pop(); // Remove current file name

  while (segments.length > 0) {
    segments.pop();
    const ancestorDir = '/' + segments.join('/');

    // Match on the context's OWN directory, never on a length-based substring:
    // sibling directories with same-length paths (/org/ALFA vs /org/BETA) must
    // never satisfy each other's ancestor lookup.
    const found = allContexts.find(c => {
      if (c.type !== 'context') return false;
      const dir = c.path.substring(0, c.path.lastIndexOf('/')) || '/';
      return dir === ancestorDir;
    });

    if (found) {
      return found;
    }
  }

  return null;
}
