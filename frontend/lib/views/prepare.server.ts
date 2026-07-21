/**
 * prepareView — the save-time gate for a view.
 *
 * Two jobs, both of which must pass before a view can be stored:
 *  1. NAMING — `_views.<name>` is an identifier that lands in saved SQL, so it
 *     must be unambiguous. Uniqueness is enforced per connection across the
 *     WHOLE context tree, in both directions: a child cannot shadow an
 *     ancestor's view, and an ancestor cannot take a name a descendant already
 *     uses (which would retroactively break that child).
 *  2. COLUMNS — the view's SQL is resolved (nested views inlined) and probed
 *     with a zero-row bound to capture its output columns AND TYPES. Types are
 *     what let the semantic layer classify measures/dimensions/time with no
 *     further config, so a saved view immediately behaves like a real table.
 */
import 'server-only';
import { runQuery } from '@/lib/connections/run-query';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { connectionTypeToDialect } from '@/lib/types';
import { resolveViewsInSql, validateViews } from '@/lib/views/resolve';
import { getViewsForPath, getAllViewsInTree } from '@/lib/views/views.server';
import { createDefaultTableViz } from '@/lib/data/story/template-defaults';
import { FilesAPI } from '@/lib/data/files.server';
import { findNearestContextPath, getPublishedVersionForUser } from '@/lib/context/context-utils';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, QuestionContent, ViewColumn, ViewDef } from '@/lib/types';

export interface PrepareViewParams {
  /** Path of the CONTEXT the view is being saved into. */
  path: string;
  connection: string;
  name: string;
  sql: string;
  /** When editing an existing view, its current name (so it doesn't collide with itself). */
  editing?: string;
}

export class ViewPrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewPrepareError';
  }
}

export async function prepareView(
  user: EffectiveUser,
  { path, connection, name, sql, editing }: PrepareViewParams,
): Promise<{ columns: ViewColumn[] }> {
  const candidate: ViewDef = { name, connection, sql };

  // ── 1. Naming: unique per connection across the entire tree ────────────────
  const others = (await getAllViewsInTree(user, connection))
    .filter((v) => !(editing && v.name === editing));
  const issues = validateViews([candidate], others);
  if (issues.length > 0) throw new ViewPrepareError(issues[0]);

  // ── 2. Columns: resolve nested views, then probe with a zero-row bound ─────
  const { type } = await ConnectionsAPI.getRawByName(connection, user.mode);
  const dialect = connectionTypeToDialect(type);

  const visible = (await getViewsForPath(path, connection, user))
    .filter((v) => v.name !== name); // a view cannot read itself
  const resolved = await resolveViewsInSql(sql, dialect, visible);

  // LIMIT 0: the engine returns the result SHAPE without scanning the data — a
  // view over a billion rows must not cost a scan just to be saved.
  const probe = `SELECT * FROM (\n${resolved}\n) AS _view_probe LIMIT 0`;
  const result = await runQuery(connection, probe, {}, user);

  const columns: ViewColumn[] = (result.columns ?? []).map((c, i) => ({
    name: c,
    type: result.types?.[i] ?? 'VARCHAR',
  }));
  if (columns.length === 0) {
    throw new ViewPrepareError('the view returned no columns');
  }
  return { columns };
}


/**
 * Promote a saved question into a view on its nearest context.
 *
 * This is how views actually get created in practice: people explore in a
 * question first, validate the numbers, and only then curate. Atomic — the
 * view is validated and column-snapshotted before the context is written.
 */
export async function promoteQuestionToView(
  user: EffectiveUser,
  { questionId, name, description }: { questionId: number; name: string; description?: string },
): Promise<ViewDef> {
  const { data: question } = await FilesAPI.loadFile(questionId, user);
  const content = question?.content as QuestionContent | undefined;
  if (!content?.query?.trim()) throw new ViewPrepareError('the question has no SQL to promote');
  const connection = content.connection_name;
  if (!connection) throw new ViewPrepareError('the question has no connection');

  // The context that will own the view: the nearest one to the question.
  const modePath = resolvePath(user.mode, '/');
  const { data: contexts } = await FilesAPI.getFiles({ type: 'context', paths: [modePath], depth: -1 }, user);
  const dir = question.path.substring(0, question.path.lastIndexOf('/')) || question.path;
  const contextPath = findNearestContextPath(contexts.map((f) => f.path), dir);
  if (!contextPath) throw new ViewPrepareError('no knowledge base found for this question');

  const { columns } = await prepareView(user, { path: contextPath, connection, name, sql: content.query });
  const view: ViewDef = {
    name, connection, sql: content.query, columns,
    viz: content.viz ?? createDefaultTableViz(),
    ...(description?.trim() ? { description: description.trim() } : {}),
  };

  // Append to the context's live version.
  const { data: contextFile } = await FilesAPI.loadFileByPath(contextPath, user);
  const ctx = contextFile.content as ContextContent;
  const live = getPublishedVersionForUser(ctx, user.userId);
  const versions = (ctx.versions ?? []).map((v) =>
    v.version === live ? { ...v, views: [...(v.views ?? []), view] } : v,
  );
  await FilesAPI.saveFile(
    contextFile.id,
    contextFile.name,
    contextFile.path,
    { ...ctx, versions } as ContextContent,
    [],
    user,
  );
  return view;
}
