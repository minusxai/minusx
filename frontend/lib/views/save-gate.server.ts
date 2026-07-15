/**
 * The context-save gate for views.
 *
 * Enforcement CANNOT live in the view dialog: a context is also writable through
 * the raw JSON editor and by the agent's EditFile. So every write of a context
 * passes through here, where we:
 *
 *  1. RECOMPUTE each view's `reads` from its SQL — never trusting whatever the
 *     client sent, which is what makes the cheap set-checks downstream sound.
 *  2. ENFORCE the boundary: a view may read only what this context's PARENT
 *     offers (so it can curate a table this context hides from users, but can
 *     never punch through the whitelist chain set above it).
 *  3. ENFORCE integrity: a view may only read views that still exist here —
 *     which means deleting a view that another view depends on fails the save,
 *     naming the dependent, instead of breaking a query later.
 */
import 'server-only';
import { computeSchemaFromWhitelist } from '@/lib/data/loaders/context-loader-utils';
import { resolveVersionWhitelist, getPublishedVersionForUser } from '@/lib/context/context-utils';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { connectionTypeToDialect } from '@/lib/types';
import { computeViewReads, checkViewAvailability, findViewCycle } from '@/lib/views/integrity';
import { validateViews } from '@/lib/views/resolve';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, DatabaseWithSchema, ViewDef } from '@/lib/types';

export class ViewSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewSaveError';
  }
}

// eslint-disable-next-line no-restricted-syntax -- keyed by (mode, connection); a dialect is immutable per connection type, and this only avoids re-reading the connection doc within a single save
const dialectCache = new Map<string, string>();
async function dialectFor(connection: string, user: EffectiveUser): Promise<string> {
  const key = `${user.mode}|${connection}`;
  const hit = dialectCache.get(key);
  if (hit) return hit;
  try {
    const { type } = await ConnectionsAPI.getRawByName(connection, user.mode);
    const dialect = connectionTypeToDialect(type);
    dialectCache.set(key, dialect);
    return dialect;
  } catch {
    return 'duckdb';
  }
}

/**
 * Stamp `reads` onto every view in the content and validate them. Returns the
 * content with reads filled in; throws ViewSaveError when a view reaches outside
 * what the parent offers, or reads a view that isn't there.
 */
export async function stampAndValidateViews(
  content: ContextContent,
  contextPath: string,
  user: EffectiveUser,
): Promise<ContextContent> {
  const versions = content.versions ?? [];
  const hasViews = versions.some((v) => (v.views?.length ?? 0) > 0);
  if (!hasViews) return content;

  // What this context's PARENT offers it. At the root this is every connection —
  // the root admin has full authority.
  const live = versions.find((v) => v.version === getPublishedVersionForUser(content, user.userId)) ?? versions[0];
  let offered: DatabaseWithSchema[] = [];
  try {
    const computed = await computeSchemaFromWhitelist(
      resolveVersionWhitelist(live),
      contextPath,
      user,
    );
    offered = computed.parentSchema;
  } catch {
    offered = [];
  }
  const inherited = content.fullViews ?? [];

  const problems: string[] = [];
  const nextVersions = await Promise.all(versions.map(async (version) => {
    const views = version.views ?? [];
    if (views.length === 0) return version;

    // Structural checks first (names, exactly-one-source, duplicates).
    const structural = validateViews(views, inherited);
    problems.push(...structural);

    const stamped: ViewDef[] = await Promise.all(views.map(async (v) => {
      if (!v.sql?.trim()) return v;
      try {
        const reads = await computeViewReads(v.sql, await dialectFor(v.connection, user));
        return { ...v, reads };
      } catch (err) {
        problems.push(`View "${v.name}": could not parse its SQL — ${err instanceof Error ? err.message : String(err)}`);
        return v;
      }
    }));

    // Cycles: a view reading itself (transitively) would fail at query time, so
    // catch it at save — consistent with the delete-a-depended-on-view guard.
    const cycle = findViewCycle([...inherited, ...stamped]);
    if (cycle) {
      problems.push(`Views form a cycle: ${cycle.join(' → ')}`);
    }

    // Boundary + integrity, against what the parent offers and the views that
    // exist here. SAVE is strict: a table read we cannot verify (unknown parent
    // schema) is refused, not waved through — the opposite of the load path.
    const visible = [...inherited, ...stamped];
    for (const v of stamped) {
      const problem = checkViewAvailability(v, offered, visible, { strictUnknownSchema: true });
      if (problem) problems.push(`View "${v.name}": ${problem}`);
    }
    return { ...version, views: stamped };
  }));

  if (problems.length > 0) {
    throw new ViewSaveError(problems.join('; '));
  }
  return { ...content, versions: nextVersions };
}
