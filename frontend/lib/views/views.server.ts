/**
 * Server-side view resolution for a file's path — the bridge between the
 * context (where views are authored, versioned and inherited) and the query
 * pipeline (where they are inlined).
 *
 * Resolution mirrors metrics/relationships: a context sees its own version's
 * views plus everything inherited from ancestors (`fullViews`, computed by the
 * context loader).
 */
import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { findNearestContextPath, getPublishedVersionForUser } from '@/lib/context/context-utils';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, ViewDef } from '@/lib/types';

/** Every view a context exposes: inherited (fullViews) + its live version's own. */
export function resolveViewsForContext(content: ContextContent | null | undefined, userId: number): ViewDef[] {
  if (!content) return [];
  const version = content.versions?.find(
    (v) => v.version === getPublishedVersionForUser(content, userId),
  ) ?? content.versions?.[0];
  return [...(content.fullViews ?? []), ...(version?.views ?? [])];
}

/** Views visible to a file at `lookupPath`, scoped to one connection. */
export async function getViewsForPath(
  lookupPath: string,
  connectionName: string,
  user: EffectiveUser,
): Promise<ViewDef[]> {
  try {
    const modePath = resolvePath(user.mode, '/');
    const { data: contextFiles } = await FilesAPI.getFiles(
      { type: 'context', paths: [modePath], depth: -1 },
      user,
    );
    const dir = lookupPath.substring(0, lookupPath.lastIndexOf('/')) || lookupPath;
    const nearest = findNearestContextPath(contextFiles.map((f) => f.path), dir);
    if (!nearest) return [];
    const { data } = await FilesAPI.loadFileByPath(nearest, user);
    const views = resolveViewsForContext(data?.content as ContextContent, user.userId);
    return views.filter((v) => v.connection === connectionName);
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
