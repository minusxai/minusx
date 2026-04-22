/**
 * Document DB — high-level SQL API for MinusX file management.
 * Execution routes through the module registry (getModules().db.exec).
 */
import { DbFile, BaseFileContent } from '../types';
import { getModules } from '../modules/registry';

export { resetAdapter as resetConnection } from './adapter/factory';

/**
 * Type for raw database row returned by database
 * Exported for reuse in import-export operations
 */
export interface DbRow {
  id: number;
  name: string;
  path: string;
  type: 'question' | 'folder' | 'dashboard' | 'notebook' | 'presentation' | 'report' | 'connection' | 'context' | 'users' | 'conversation' | 'session' | 'config';
  content: string;
  file_references: string;
  created_at: string;
  updated_at: string;
  version: number;
  last_edit_id: string | null;
}

export class DocumentDB {
  static async create(name: string, path: string, type: string, content: BaseFileContent, references: number[], editId?: string): Promise<number> {
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
        SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files
      )
      INSERT INTO files (id, name, path, type, content, file_references, version, last_edit_id, created_at, updated_at)
      SELECT next_id, $1, $2, $3, $4, $5, 1, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM next_id_gen, lock
      RETURNING id
    `, [name, path, type, JSON.stringify(content), JSON.stringify(references), editId ?? null]);

    return result.rows[0].id;
  }

  static async getById(id: number, includeContent: boolean = true): Promise<DbFile | null> {
    const db = getModules().db;

    const query = includeContent
      ? 'SELECT * FROM files WHERE id = $1'
      : 'SELECT id, name, path, type, file_references, created_at, updated_at FROM files WHERE id = $1';

    const result = await db.exec<DbRow>(query, [id]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type,
      references: JSON.parse(row.file_references || '[]'),
      content: includeContent ? JSON.parse(row.content) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      version: row.version ?? 1,
      last_edit_id: row.last_edit_id ?? null,
    };
  }

  static async getByIds(ids: number[], includeContent: boolean = true): Promise<DbFile[]> {
    if (ids.length === 0) return [];

    const db = getModules().db;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const columns = includeContent
      ? '*'
      : 'id, name, path, type, file_references, created_at, updated_at';

    const result = await db.exec<DbRow>(
      `SELECT ${columns} FROM files WHERE id IN (${placeholders})`,
      ids
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type,
      references: JSON.parse(row.file_references || '[]'),
      content: includeContent ? JSON.parse(row.content) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      version: row.version ?? 1,
      last_edit_id: row.last_edit_id ?? null,
    }));
  }

  static async getByPath(path: string, includeContent: boolean = true): Promise<DbFile | null> {
    const db = getModules().db;

    const query = includeContent
      ? 'SELECT * FROM files WHERE path = $1'
      : 'SELECT id, name, path, type, file_references, created_at, updated_at FROM files WHERE path = $1';

    const result = await db.exec<DbRow>(query, [path]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type,
      references: JSON.parse(row.file_references || '[]'),
      content: includeContent ? JSON.parse(row.content) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      version: row.version ?? 1,
      last_edit_id: row.last_edit_id ?? null,
    };
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

    const columns = includeContent
      ? '*'
      : 'id, name, path, type, file_references, created_at, updated_at';

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT ${columns} FROM files ${whereClause} ORDER BY updated_at DESC`;
    const result = await db.exec<DbRow>(sql, params);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type,
      references: JSON.parse(row.file_references || '[]'),
      content: includeContent ? JSON.parse(row.content) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      version: row.version ?? 1,
      last_edit_id: row.last_edit_id ?? null,
    }));
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
      'UPDATE files SET name = $1, path = $2, content = $3, file_references = $4, version = $5, last_edit_id = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7',
      [name, path, JSON.stringify(content), JSON.stringify(references), (currentRow.version ?? 1) + 1, editId ?? null, id]
    );

    const updated = await db.exec<DbRow>('SELECT * FROM files WHERE id = $1', [id]);
    return { file: updated.rows[0] };
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
}
