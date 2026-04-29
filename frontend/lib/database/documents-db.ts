/**
 * Document DB — high-level SQL API for MinusX file management.
 * Execution routes through the module registry (getModules().db.exec).
 */
import { DbFile, BaseFileContent } from '../types';
import { getModules } from '../modules/registry';
import { DEFAULT_CONVERSATION_NAME } from '../constants';

/**
 * Type for raw database row returned by database
 * Exported for reuse in import-export operations
 */
export interface DbRow {
  id: number;
  name: string;
  path: string;
  type: 'question' | 'folder' | 'dashboard' | 'notebook' | 'presentation' | 'report' | 'connection' | 'context' | 'users' | 'conversation' | 'session' | 'config';
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
    type: row.type,
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
  static async create(name: string, path: string, type: string, content: BaseFileContent, references: number[], editId?: string, draft: boolean = true): Promise<number> {
    if (references.some(ref => ref < 0)) {
      throw new Error(
        `Cannot store negative reference IDs in the database: [${references.filter(r => r < 0).join(', ')}]. ` +
        `This indicates a bug — virtual file IDs must be resolved before saving.`
      );
    }

    const db = getModules().db;

    const result = await db.exec<{ id: number }>(`
      WITH lock AS (
        SELECT pg_advisory_xact_lock(1) AS lock_acquired
      ),
      next_id_gen AS (
        SELECT GREATEST(COALESCE(MAX(id), 0) + 1, 1000) AS next_id FROM files
      )
      INSERT INTO files (id, name, path, type, content, file_references, version, last_edit_id, draft, meta, created_at, updated_at)
      SELECT next_id, $1, $2, $3, $4, $5, 1, $6, $7, null, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM next_id_gen, lock
      RETURNING id
    `, [name, path, type, content, references, editId ?? null, draft]);

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

  static async getByIds(ids: number[], includeContent: boolean = true): Promise<DbFile[]> {
    if (ids.length === 0) return [];

    const db = getModules().db;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const columns = includeContent
      ? '*'
      : 'id, name, path, type, file_references, created_at, updated_at, version, last_edit_id, draft, meta';

    const result = await db.exec<DbRow>(
      `SELECT ${columns} FROM files WHERE id IN (${placeholders})`,
      ids
    );

    return result.rows.map(row => rowToDbFile(row, includeContent));
  }

  static async getByPath(path: string, includeContent: boolean = true): Promise<DbFile | null> {
    const db = getModules().db;

    const query = includeContent
      ? 'SELECT * FROM files WHERE path = $1'
      : 'SELECT id, name, path, type, file_references, created_at, updated_at, version, last_edit_id, draft, meta FROM files WHERE path = $1';

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

    await db.exec(
      'UPDATE files SET name = $1, path = $2, content = $3, file_references = $4, version = $5, last_edit_id = $6, draft = false, updated_at = CURRENT_TIMESTAMP WHERE id = $7',
      [name, path, content, references, (currentRow.version ?? 1) + 1, editId ?? null, id]
    );

    const updated = await db.exec<DbRow>('SELECT * FROM files WHERE id = $1', [id]);
    return { file: updated.rows[0] };
  }

  /**
   * Batch-save multiple files in a single transaction.
   * If dryRun is true, the transaction is always rolled back — useful for pre-flight
   * validation that catches path conflicts across the full set of edits.
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
    await db.exec('BEGIN');

    let failedId: number = inputs[0].id;
    try {
      for (const input of inputs) {
        failedId = input.id;
        await DocumentDB.update(
          input.id, input.name, input.path, input.content,
          input.references, input.editId ?? String(Date.now()), input.expectedVersion
        );
      }

      if (dryRun) {
        await db.exec('ROLLBACK');
      } else {
        await db.exec('COMMIT');
      }

      return { success: true, errors: [] };
    } catch (error: any) {
      try { await db.exec('ROLLBACK'); } catch { /* ignore secondary rollback errors */ }
      return { success: false, errors: [{ id: failedId, error: error.message ?? String(error) }] };
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
    const result = await getModules().db.exec(
      'UPDATE files SET name = $1, path = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [name, path, id]
    );
    return result.rowCount > 0;
  }

  static async moveFolderAndChildren(
    folderId: number,
    descendantIds: number[],
    oldPath: string,
    newPath: string,
    newName: string
  ): Promise<number> {
    if (descendantIds.length === 0) {
      const updated = await this.updateMetadata(folderId, newName, newPath);
      return updated ? 1 : 0;
    }

    const db = getModules().db;
    const allIds = [folderId, ...descendantIds];
    const placeholders = allIds.map((_, i) => `$${i + 5}`).join(', ');
    const result = await db.exec(
      `UPDATE files
       SET
         name = CASE WHEN id = $1 THEN $2 ELSE name END,
         path = CASE
           WHEN id = $1 THEN $3
           ELSE $3 || substr(path, length($4) + 1)
         END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders})`,
      [folderId, newName, newPath, oldPath, ...allIds]
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

    const params: any[] = [id, JSON.stringify(entries), new Date().toISOString()];
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
}
