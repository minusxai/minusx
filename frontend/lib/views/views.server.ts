/**
 * Server-side view resolution for a file's path — the bridge between the
 * context (where views are authored, versioned and inherited) and the query
 * pipeline (where they are inlined).
 *
 * Resolution mirrors metrics: a context sees its own version's
 * views plus everything inherited from ancestors (`fullViews`, computed by the
 * context loader).
 */
import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { findNearestContextPath, getPublishedVersionForUser } from '@/lib/context/context-utils';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, ViewDef } from '@/lib/types';
import type { HydratedView } from '@/lib/views/resolve';

/**
 * Every view a context exposes: inherited (fullViews) + its live version's own,
 * MINUS any the loader disabled (`viewProblems` — e.g. an ancestor pulled a table
 * it reads) and any turned OFF (`whitelistedColumns: []`). Neither must resolve:
 * the query fails loudly instead of quietly reading data the org has since
 * withdrawn — or, for an OFF view, instead of "succeeding" against a stub.
 *
 * The OFF filter matches `viewsAsSchemaTables`, which already drops such a view
 * from every schema. Without it the two disagreed in exactly one configuration:
 * under an explicit whitelist the missing schema entry refused the query, but a
 * `*` workspace skips table validation, so the same OFF view resolved to its
 * `SELECT NULL AS _off` stub and returned rows. "Off" has to mean one thing.
 */
export function resolveViewsForContext(content: ContextContent | null | undefined, userId: number): ViewDef[] {
  if (!content) return [];
  const version = content.versions?.find(
    (v) => v.version === getPublishedVersionForUser(content, userId),
  ) ?? content.versions?.[0];
  const broken = new Set((content.viewProblems ?? []).map((p) => p.view));
  return [...(content.fullViews ?? []), ...(version?.views ?? [])]
    .filter((v) => !broken.has(v.name))
    .filter((v) => !(v.whitelistedColumns && v.whitelistedColumns.length === 0));
}

/**
 * Views are INLINE SQL: a view carries its own SQL, so nothing can change it
 * behind the authorization that approved it. ("Promote to view" copies a
 * question's SQL in; the question is a starting point, not a live dependency —
 * a live link would let the question's SQL drift outside what the view was
 * allowed to read.)
 */
const hydrated = (views: ViewDef[]): HydratedView[] =>
  views.filter((v): v is HydratedView => !!v.sql?.trim());

/** Views visible at `lookupPath` — a file path or a folder anchor (e.g. chat's home folder) — scoped to one connection (SQL hydrated). */
export async function getViewsForPath(
  lookupPath: string,
  connectionName: string,
  user: EffectiveUser,
): Promise<HydratedView[]> {
  try {
    const modePath = resolvePath(user.mode, '/');
    const { data: contextFiles } = await FilesAPI.getFiles(
      { type: 'context', paths: [modePath], depth: -1 },
      user,
    );
    // The path goes in WHOLE. `findNearestContextPath` already matches a context
    // whose serving folder is the path itself OR any ancestor of it, so it takes
    // a file path and a folder path alike. Stripping the last segment first would
    // be right for a file and wrong for the FOLDER anchor chat and MCP use: it
    // walks past that folder's own context, resolving views from one context
    // while `getWhitelistForPath` — which never strips — resolves the
    // whitelist from another.
    const nearest = findNearestContextPath(contextFiles.map((f) => f.path), lookupPath);
    if (!nearest) return [];
    const { data } = await FilesAPI.loadFileByPath(nearest, user);
    const views = resolveViewsForContext(data?.content as ContextContent, user.userId)
      .filter((v) => v.connection === connectionName);
    return hydrated(views);
  } catch {
    return []; // no context / not readable → no views (queries against them then fail loudly)
  }
}

/**
 * Every view defined ANYWHERE in the context tree for a connection.
 *
 * Uniqueness must be enforced across the whole tree, not just the ancestor
 * chain: an ancestor taking a name a descendant already uses would retroactively
 * break that child (whose author can't see it coming, and whose admin can't see
 * child views).
 */
export async function getAllViewsInTree(
  user: EffectiveUser,
  connectionName: string,
): Promise<ViewDef[]> {
  const modePath = resolvePath(user.mode, '/');
  const { data: contextFiles } = await FilesAPI.getFiles(
    { type: 'context', paths: [modePath], depth: -1 },
    user,
  );
  if (contextFiles.length === 0) return [];
  const { data: loaded } = await FilesAPI.loadFiles(contextFiles.map((f) => f.id), user);

  const all: ViewDef[] = [];
  for (const file of loaded) {
    const content = file.content as ContextContent | undefined;
    // OWN views only, per context — fullViews would double-count inherited ones.
    for (const version of content?.versions ?? []) {
      for (const v of version.views ?? []) {
        if (v.connection === connectionName) all.push(v);
      }
    }
  }
  return all;
}
