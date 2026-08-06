/**
 * Document DB — high-level SQL API for MinusX file management.
 * Execution routes through the module registry (getModules().db.exec).
 */
import { DbFile, BaseFileContent } from '../types';
import { getModules } from '../modules/registry';
import { DEFAULT_CONVERSATION_NAME } from '../constants';
import { UserFacingError } from '../errors';
import { stripNulChars } from './sanitize-jsonb';

/**
 * Path uniqueness applies to PUBLISHED files only (partial index
 * idx_files_path_published_unique, WHERE draft = false); drafts are exempt. A 23505 here therefore
 * means another PUBLISHED file already occupies this path — translate it into a clear, actionable
 * message instead of letting the raw Postgres constraint error surface to the user.
 */
const PUBLISHED_PATH_CONFLICT_MSG =
  'A published file already exists at this path. Rename this file before saving.';

function isPublishedPathConflict(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === '23505'
    || /idx_files_path_published_unique|unique constraint|duplicate key/i.test(String(e.message ?? ''));
}

/** Run a write, translating a published-path unique violation into a UserFacingError. */
async function withPathConflictTranslation<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isPublishedPathConflict(error)) throw new UserFacingError(PUBLISHED_PATH_CONFLICT_MSG);
    throw error;
  }
}

/**
 * Type for raw database row returned by database
 * Exported for reuse in import-export operations
 */
export interface DbRow {
  id: number;
  name: string;
  path: string;
  type: 'question' | 'folder' | 'dashboard' | 'story' | 'notebook' | 'report' | 'connection' | 'context' | 'users' | 'conversation' | 'session' | 'config';
  content: any;           // JSONB — driver returns parsed JS object
  file_references: any[]; // JSONB — driver returns parsed JS array
  created_at: string;
  updated_at: string;
  version: number;
  last_edit_id: string | null;
  draft: boolean;
  meta: Record<string, unknown> | null;
}

/** Convert a raw DB row to a typed DbFile, reading draft/meta from the row. */
function rowToDbFile(row: DbRow, includeContent: boolean = true): DbFile {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    // Legacy 'conversation' rows (pre-v3-migration DBs) don't fit the FileType union —
    // they exist only until migrate-conversations-v3 converts them.
    type: row.type as DbFile['type'],
    references: row.file_references || [],
    content: includeContent ? row.content : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version ?? 1,
    last_edit_id: row.last_edit_id ?? null,
    draft: row.draft ?? false,
    meta: row.meta ?? null,
  };
}

export class DocumentDB {
  static async create(
    name: string,
    path: string,
    type: string,
    content: BaseFileContent,
    references: number[],
    editId?: string,
    draft: boolean = true,
    meta?: Record<string, unknown> | null,
  ): Promise<number> {
    if (references.some(ref => ref < 0)) {
      throw new Error(
        `Cannot store negative reference IDs in the database: [${references.filter(r => r < 0).join(', ')}]. ` +
        `This indicates a bug — virtual file IDs must be resolved before saving.`
      );
    }

    const db = getModules().db;

    // Drafts (draft = true, the default) never collide on path. A published-file create
    // (draft = false) at a path another published file already occupies hits the partial unique
    // index — translate it to the same clear "rename" message rather than a raw 23505.
    const result = await withPathConflictTranslation(() => db.exec<{ id: number }>(`
      WITH lock AS (
        SELECT pg_advisory_xact_lock(1) AS lock_acquired
      ),
      next_id_gen AS (
        SELECT GREATEST(COALESCE(MAX(id), 0) + 1, 1000) AS next_id FROM files
      )
      INSERT INTO files (id, name, path, type, content, file_references, version, last_edit_id, draft, meta, created_at, updated_at)
      SELECT next_id, $1, $2, $3, $4, $5, 1, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM next_id_gen, lock
      RETURNING id
    `, [name, path, type, stripNulChars(content), references, editId ?? null, draft, stripNulChars(meta ?? null)]));

    return result.rows[0].id;
  }

  static async getById(id: number, includeContent: boolean = true): Promise<DbFile | null> {
    const db = getModules().db;

    const query = includeContent
      ? 'SELECT * FROM files WHERE id = $1'
      : 'SELECT id, name, path, type, file_references, created_at, updated_at, version, last_edit_id, draft, meta FROM files WHERE id = $1';

    const result = await db.exec<DbRow>(query, [id]);
    if (result.rows.length === 0) return null;

    return rowToDbFile(result.rows[0], includeContent);
  }

  /**
   * Find the file holding a given public-share nonce in its `meta.shares[]`.
   * Uses a JSONB containment match (`@>`), accelerated by the GIN index on
   * `(meta -> 'shares')`. Nonces are globally unique random keys, so at most one matches.
   */
  static async findByShareNonce(nonce: string): Promise<DbFile | null> {
    const db = getModules().db;
    const result = await db.exec<DbRow>(
      `SELECT * FROM files WHERE meta -> 'shares' @> $1::jsonb LIMIT 1`,
      [JSON.stringify([{ nonce }])]
    );
    if (result.rows.length === 0) return null;
    return rowToDbFile(result.rows[0], true);
  }

  static async getByIds(ids: number[], includeContent: boolean = true): Promise<DbFile[]> {
    // Drop virtual/placeholder IDs (negative, from pathToVirtualId) and any other
    // non-positive-integer values: they have no DB row and can exceed int4 range,
    // which would make `WHERE id IN (...)` throw 22003 ("out of range for integer").
    const dbIds = ids.filter((id) => Number.isInteger(id) && id > 0);
    if (dbIds.length === 0) return [];

    const db = getModules().db;
    const placeholders = dbIds.map((_, i) => `$${i + 1}`).join(',');
    const columns = includeContent
      ? '*'
      : 'id, name, path, type, file_references, created_at, updated_at, version, last_edit_id, draft, meta';

    const result = await db.exec<DbRow>(
      `SELECT ${columns} FROM files WHERE id IN (${placeholders})`,
      dbIds
    );

    return result.rows.map(row => rowToDbFile(row, includeContent));
  }

  static async getByPath(path: string, includeContent: boolean = true): Promise<DbFile | null> {
    const db = getModules().db;

    // Multiple DRAFTS can share a path (only published files are path-unique — see
    // idx_files_path_published_unique). Prefer the published file (draft ASC → false first), then
    // the most recently updated, so path lookups are deterministic and a draft never shadows the
    // canonical published file.
    const order = ' ORDER BY draft ASC, updated_at DESC LIMIT 1';
    const query = includeContent
      ? `SELECT * FROM files WHERE path = $1${order}`
      : `SELECT id, name, path, type, file_references, created_at, updated_at, version, last_edit_id, draft, meta FROM files WHERE path = $1${order}`;

    const result = await db.exec<DbRow>(query, [path]);
    if (result.rows.length === 0) return null;

    return rowToDbFile(result.rows[0], includeContent);
  }

  static async listAll(
    typeFilter?: string,
    pathFilters?: string[],
    depth?: number,
    includeContent: boolean = true
  ): Promise<DbFile[]> {
    const db = getModules().db;
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (typeFilter) {
      conditions.push(`type = $${paramIndex}`);
      params.push(typeFilter);
      paramIndex++;
    }

    if (pathFilters && pathFilters.length > 0) {
      const pathConditions: string[] = [];

      for (const folderPath of pathFilters) {
        if (folderPath === '/') {
          pathConditions.push('1=1');
          continue;
        }

        if (depth === -1) {
          pathConditions.push(`path LIKE $${paramIndex}`);
          params.push(`${folderPath}/%`);
          paramIndex++;
        } else if (depth && depth > 0) {
          const baseSlashCount = (folderPath.match(/\//g) || []).length;
          const maxSlashCount = baseSlashCount + depth;
          pathConditions.push(
            `(path LIKE $${paramIndex} AND (length(path) - length(replace(path, '/', ''))) <= $${paramIndex + 1})`
          );
          params.push(`${folderPath}/%`, maxSlashCount);
          paramIndex += 2;
        } else {
          pathConditions.push(`path LIKE $${paramIndex}`);
          params.push(`${folderPath}/%`);
          paramIndex++;
        }
      }

      if (pathConditions.length > 0) {
        conditions.push(`(${pathConditions.join(' OR ')})`);
      }
    }

    // Always exclude draft files from listings
    conditions.push('draft = false');

    const columns = includeContent
      ? '*'
      : 'id, name, path, type, file_references, created_at, updated_at, version, last_edit_id, draft, meta';

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT ${columns} FROM files ${whereClause} ORDER BY updated_at DESC`;
    const result = await db.exec<DbRow>(sql, params);

    return result.rows.map(row => rowToDbFile(row, includeContent));
  }

  static async update(
    id: number,
    name: string,
    path: string,
    content: BaseFileContent,
    references: number[],
    editId: string,
    expectedVersion?: number
  ): Promise<
    | { alreadyApplied: true; file: DbRow }
    | { conflict: true; file: DbRow }
    | { file: DbRow }
  > {
    const db = getModules().db;

    const current = await db.exec<DbRow>('SELECT * FROM files WHERE id = $1', [id]);
    if (current.rows.length === 0) throw new Error(`File ${id} not found`);

    const currentRow = current.rows[0];

    if (editId && editId === currentRow.last_edit_id) {
      return { alreadyApplied: true, file: currentRow };
    }

    if (expectedVersion !== undefined && currentRow.version !== expectedVersion) {
      return { conflict: true, file: currentRow };
    }

    // This UPDATE sets draft = false (publish). If another PUBLISHED file already occupies `path`,
    // the partial unique index rejects it — surface a clear "rename" message, not a raw 23505.
    await withPathConflictTranslation(() => db.exec(
      'UPDATE files SET name = $1, path = $2, content = $3, file_references = $4, version = $5, last_edit_id = $6, draft = false, updated_at = CURRENT_TIMESTAMP WHERE id = $7',
      [name, path, stripNulChars(content), references, (currentRow.version ?? 1) + 1, editId ?? null, id]
    ));

    const updated = await db.exec<DbRow>('SELECT * FROM files WHERE id = $1', [id]);
    return { file: updated.rows[0] };
  }

  /**
   * Batch-save multiple files atomically.
   *
   * The check phase is PURE READS: every target row is loaded, already-applied
   * entries (same editId) and expectedVersion conflicts are skipped exactly as
   * the per-file `update` would, and publish-path conflicts — against existing
   * published rows AND between entries of this batch — are detected by SELECT.
   * With `dryRun` that is the whole call: a preflight never writes. (It must
   * not: on the pooled Postgres backend `exec('BEGIN')`/`exec('ROLLBACK')` do
   * not bracket the statements between them, so a write-then-rollback
   * preflight would actually commit.)
   *
   * The write phase is ONE `UPDATE … FROM (VALUES …)` — atomic on every
   * backend with no client-side transaction, same pattern as
   * `applyFolderMove`. The published-path unique index remains the backstop
   * for races past the SELECT check; either way nothing partial can commit.
   */
  static async batchSave(
    inputs: Array<{
      id: number;
      name: string;
      path: string;
      content: BaseFileContent;
      references: number[];
      editId?: string;
      expectedVersion?: number;
    }>,
    dryRun: boolean = false
  ): Promise<{ success: boolean; errors: Array<{ id: number; error: string }> }> {
    if (inputs.length === 0) return { success: true, errors: [] };

    const db = getModules().db;

    const idPlaceholders = inputs.map((_, i) => `$${i + 1}`).join(', ');
    const current = await db.exec<DbRow>(
      `SELECT * FROM files WHERE id IN (${idPlaceholders})`,
      inputs.map((r) => r.id)
    );
    const byId = new Map<number, DbRow>(current.rows.map((r) => [r.id, r]));

    const toWrite: typeof inputs = [];
    const targetPaths = new Set<string>();
    for (const input of inputs) {
      const row = byId.get(input.id);
      if (!row) {
        return { success: false, errors: [{ id: input.id, error: `File ${input.id} not found` }] };
      }
      if (input.editId && input.editId === row.last_edit_id) continue; // already applied
      if (input.expectedVersion !== undefined && row.version !== input.expectedVersion) continue; // stale entry
      if (targetPaths.has(input.path)) {
        return { success: false, errors: [{ id: input.id, error: PUBLISHED_PATH_CONFLICT_MSG }] };
      }
      targetPaths.add(input.path);
      toWrite.push(input);
    }

    if (toWrite.length > 0) {
      // A PUBLISHED row already occupying any target path (other than the row
      // being saved) makes the whole batch a conflict.
      const pathPlaceholders = toWrite.map((_, i) => `$${i + 1}`).join(', ');
      const occupied = await db.exec<{ id: number; path: string }>(
        `SELECT id, path FROM files WHERE draft = false AND path IN (${pathPlaceholders})`,
        toWrite.map((r) => r.path)
      );
      for (const input of toWrite) {
        const squatter = occupied.rows.find((o) => o.path === input.path && o.id !== input.id);
        if (squatter) {
          return { success: false, errors: [{ id: input.id, error: PUBLISHED_PATH_CONFLICT_MSG }] };
        }
      }
    }

    if (dryRun || toWrite.length === 0) return { success: true, errors: [] };

    const values: string[] = [];
    const params: unknown[] = [];
    for (const r of toWrite) {
      const base = params.length;
      values.push(`($${base + 1}::int, $${base + 2}::text, $${base + 3}::text, $${base + 4}::jsonb, $${base + 5}::jsonb, $${base + 6}::text)`);
      params.push(
        r.id, r.name, r.path,
        JSON.stringify(stripNulChars(r.content)),
        JSON.stringify(r.references),
        r.editId ?? String(byId.get(r.id)!.version)
      );
    }
    try {
      await withPathConflictTranslation(() => db.exec(
        `UPDATE files f
         SET
           name = v.name,
           path = v.path,
           content = v.content,
           file_references = v.file_references,
           last_edit_id = v.edit_id,
           version = f.version + 1,
           draft = false,
           updated_at = CURRENT_TIMESTAMP
         FROM (VALUES ${values.join(', ')}) AS v(id, name, path, content, file_references, edit_id)
         WHERE f.id = v.id`,
        params
      ));
      return { success: true, errors: [] };
    } catch (error: any) {
      // Race past the SELECT check: the unique index aborted the statement, so
      // nothing was written; attribution falls back to the first entry.
      return { success: false, errors: [{ id: toWrite[0].id, error: error.message ?? String(error) }] };
    }
  }

  static async getByEditId(editId: string): Promise<DbRow | null> {
    const result = await getModules().db.exec<DbRow>(
      'SELECT * FROM files WHERE last_edit_id = $1',
      [editId]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  static async updateMetadata(id: number, name: string, path: string): Promise<boolean> {
    // version++ so any other tab holding a stale snapshot gets a ConflictError
    // on its next save (rather than silently re-writing the old path).
    const result = await getModules().db.exec(
      'UPDATE files SET name = $1, path = $2, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [name, path, id]
    );
    return result.rowCount > 0;
  }

  /**
   * Overwrite the `meta` JSONB blob for a file (read-modify-write the whole object at the
   * call site). Does NOT bump version or touch content — meta is sidebar-cheap, out-of-band
   * file-level metadata (e.g. public share records). Returns false if the file doesn't exist.
   */
  static async updateMeta(id: number, meta: Record<string, unknown> | null): Promise<boolean> {
    const result = await getModules().db.exec(
      'UPDATE files SET meta = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [stripNulChars(meta ?? null), id]
    );
    return result.rowCount > 0;
  }

  /**
   * Apply a folder move as ONE statement. Every row a move touches lives in
   * the same `files` table — the folder (rename + path), its descendants (path
   * prefix), and any context document whose `childPaths` referenced the moved
   * subtree (content + edit id) — so the whole move is a single
   * `UPDATE … FROM (VALUES …)`. A single statement is atomic on every backend
   * with no client-side transaction machinery: PGLite, pooled Postgres (where
   * `exec('BEGIN')`/`exec('COMMIT')` would NOT be a transaction — each exec
   * may use a different pool client), and wrappers that put their own
   * transaction around each exec. A NULL column in a row's VALUES entry keeps
   * the current value; version++ on every touched row so any stale snapshot
   * gets a ConflictError on its next save rather than silently resurrecting
   * the old path.
   */
  static async applyFolderMove(
    rows: Array<{ id: number; name?: string; path?: string; content?: BaseFileContent; editId?: string }>
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const db = getModules().db;
    const values: string[] = [];
    const params: unknown[] = [];
    for (const r of rows) {
      const base = params.length;
      values.push(`($${base + 1}::int, $${base + 2}::text, $${base + 3}::text, $${base + 4}::jsonb, $${base + 5}::text)`);
      params.push(
        r.id,
        r.name ?? null,
        r.path ?? null,
        r.content !== undefined ? JSON.stringify(stripNulChars(r.content)) : null,
        r.editId ?? null
      );
    }
    const result = await db.exec(
      `UPDATE files f
       SET
         name = COALESCE(v.name, f.name),
         path = COALESCE(v.path, f.path),
         content = COALESCE(v.content, f.content),
         last_edit_id = COALESCE(v.edit_id, f.last_edit_id),
         version = f.version + 1,
         updated_at = CURRENT_TIMESTAMP
       FROM (VALUES ${values.join(', ')}) AS v(id, name, path, content, edit_id)
       WHERE f.id = v.id`,
      params
    );
    return result.rowCount;
  }

  static async deleteByIds(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const db = getModules().db;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const result = await db.exec(
      `DELETE FROM files WHERE id IN (${placeholders})`,
      ids
    );
    return result.rowCount;
  }

  static async updatePath(id: number, newPath: string): Promise<boolean> {
    const result = await getModules().db.exec(
      'UPDATE files SET path = $1 WHERE id = $2',
      [newPath, id]
    );
    return result.rowCount > 0;
  }

  /**
   * Atomically append entries to a nested JSON array inside `content`.
   *
   * `arrayPath`  – dot-separated path to the array (e.g. `'log'` or `'data.items'`).
   *               Translated to Postgres `{}` syntax for `jsonb_set`.
   * `metaPath`   – optional dot-separated path to a string field updated to the current
   *               ISO timestamp (e.g. `'metadata.updatedAt'`). Pass null to skip.
   * `expectedLength` – current array length for optimistic concurrency check; the row
   *               is only updated when the current array length matches. Pass undefined
   *               to skip the check and always append.
   *
   * Returns true when the row was updated, false on conflict (length mismatch).
   */
  static async appendJsonArray(
    id: number,
    entries: any[],
    expectedLength: number | undefined,
    arrayPath: string = 'log',
    metaPath: string | null = 'metadata.updatedAt'
  ): Promise<boolean> {
    const db = getModules().db;

    const pgArrayPath  = `{${arrayPath.replace(/\./g, ',')}}`;
    const arrayNavSQL  = arrayPath.split('.').map(k => `-> '${k}'`).join(' ');

    const params: any[] = [id, JSON.stringify(stripNulChars(entries)), new Date().toISOString()];
    const lengthCondition = expectedLength !== undefined
      ? `AND jsonb_array_length(content ${arrayNavSQL}) = $${params.push(expectedLength)}`
      : '';

    let contentUpdate: string;
    if (metaPath) {
      const pgMetaPath = `{${metaPath.replace(/\./g, ',')}}`;
      contentUpdate = `jsonb_set(
           jsonb_set(content, '${pgArrayPath}',
             (content ${arrayNavSQL}) || $2::jsonb),
           '${pgMetaPath}', to_jsonb($3::text)
         )`;
    } else {
      contentUpdate = `jsonb_set(content, '${pgArrayPath}',
           (content ${arrayNavSQL}) || $2::jsonb)`;
    }

    const result = await db.exec(
      `UPDATE files
       SET
         content = ${contentUpdate},
         version = version + 1,
         draft = false,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       ${lengthCondition}`,
      params
    );
    return result.rowCount > 0;
  }

  static async updateNamePath(id: number, name: string, path: string): Promise<void> {
    const db = getModules().db;
    await db.exec(
      `UPDATE files
       SET name = $2, path = $3,
           content = jsonb_set(content, '{metadata,name}', to_jsonb($2::text)),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND (content->'metadata'->>'name' = $4 OR name = $4)`,
      [id, name, path, DEFAULT_CONVERSATION_NAME]
    );
  }

  /**
   * Rename + move a file row without touching content. Unconditional —
   * caller is responsible for any preconditions.
   */
  static async renameAndMove(id: number, name: string, path: string): Promise<void> {
    const db = getModules().db;
    await db.exec(
      `UPDATE files
       SET name = $2, path = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id, name, path],
    );
  }
}
