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
