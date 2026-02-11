/**
 * SQLite database module for Atlas document management.
 * Handles CRUD operations for questions, dashboards, notebooks, slides, and reports.
 * Phase 2: Uses integer IDs instead of UUIDs
 * Phase 3: Uses database adapter interface (async)
 */
import { DbFile, AccessToken, BaseFileContent } from '../types';
import { DB_PATH, DB_DIR } from './db-config';
import { randomUUID } from 'crypto';
import { getAdapter } from './adapter/factory';
import { IDatabaseAdapter } from './adapter/types';

export { DB_PATH, DB_DIR };
export { resetAdapter as resetConnection } from './adapter/factory';

/**
 * Type for raw database row returned by database
 * Exported for reuse in import-export operations
 */
export interface DbRow {
  id: number;  // Phase 2: Integer ID
  name: string;
  path: string;
  type: 'question' | 'folder' | 'dashboard' | 'notebook' | 'presentation' | 'report' | 'connection' | 'context' | 'users' | 'conversation' | 'session' | 'config';
  content: string; // JSON string
  file_references: string;  // Phase 6: JSON array of referenced file IDs (renamed from "references" to avoid SQL keyword)
  company_id: number;
  created_at: string;
  updated_at: string;
}

// Phase 6: extractReferencesFromContent moved to client-side (lib/data/helpers/extract-references.ts)
// Server is dumb - just saves what client sends

/**
 * Get next ID for a company (replaces id-generator.ts logic inline)
 */
async function getNextId(db: IDatabaseAdapter, table: string, companyId: number): Promise<number> {
  const result = await db.query<{ next_id: number }>(
    `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${table} WHERE company_id = $1`,
    [companyId]
  );
  return result.rows[0].next_id;
}

export class DocumentDB {
  /**
   * Create a new file with per-company auto-increment ID
   * @param references - Pre-extracted references from client (Phase 6: server is dumb)
   * @param company_id - The company ID for tenant isolation (REQUIRED for security)
   * @returns The per-company generated integer ID
   */
  static async create(name: string, path: string, type: string, content: BaseFileContent, references: number[], company_id: number): Promise<number> {
    const db = await getAdapter();

    // Get next ID for this company
    const nextId = await getNextId(db, 'files', company_id);

    // Phase 6: Server is dumb - client sends pre-extracted references
    await db.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [company_id, nextId, name, path, type, JSON.stringify(content), JSON.stringify(references)]
    );

    return nextId;
  }

  /**
   * Get a file by integer ID
   * @param company_id - The company ID for tenant isolation (REQUIRED for security)
   * @param includeContent - Whether to include content field (defaults to true)
   */
  static async getById(id: number, company_id: number, includeContent: boolean = true): Promise<DbFile | null> {
    const db = await getAdapter();

    // Select only metadata columns when includeContent is false (Phase 6: file_references always included)
    const query = includeContent
      ? 'SELECT * FROM files WHERE id = $1 AND company_id = $2'
      : 'SELECT id, name, path, type, file_references, company_id, created_at, updated_at FROM files WHERE id = $1 AND company_id = $2';

    const result = await db.query<DbRow>(query, [id, company_id]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type,
      references: JSON.parse(row.file_references || '[]'),  // Phase 6: Always include references
      content: includeContent ? JSON.parse(row.content) : null,
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Get multiple files by integer IDs (bulk fetch)
   * Prevents N+1 query problem when loading multiple files
   * @param ids - Array of file IDs to fetch
   * @param company_id - The company ID for tenant isolation (REQUIRED for security)
   * @param includeContent - Whether to include content field (defaults to true)
   * @returns Array of files (preserves order of IDs)
   */
  static async getByIds(ids: number[], company_id: number, includeContent: boolean = true): Promise<DbFile[]> {
    if (ids.length === 0) {
      return [];
    }

    const db = await getAdapter();
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

    // Select only metadata columns when includeContent is false (Phase 6: file_references always included)
    const columns = includeContent
      ? '*'
      : 'id, name, path, type, file_references, company_id, created_at, updated_at';

    const result = await db.query<DbRow>(
      `SELECT ${columns} FROM files WHERE id IN (${placeholders}) AND company_id = $${ids.length + 1}`,
      [...ids, company_id]
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type,
      references: JSON.parse(row.file_references || '[]'),  // Phase 6: Always include references
      content: includeContent ? JSON.parse(row.content) : null,
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  /**
   * Get a file by path
   * @param company_id - The company ID for tenant isolation (REQUIRED for security)
   * @param includeContent - Whether to include content field (defaults to true)
   */
  static async getByPath(path: string, company_id: number, includeContent: boolean = true): Promise<DbFile | null> {
    const db = await getAdapter();

    // Select only metadata columns when includeContent is false (Phase 6: file_references always included)
    const query = includeContent
      ? 'SELECT * FROM files WHERE path = $1 AND company_id = $2'
      : 'SELECT id, name, path, type, file_references, company_id, created_at, updated_at FROM files WHERE path = $1 AND company_id = $2';

    const result = await db.query<DbRow>(query, [path, company_id]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type,
      references: JSON.parse(row.file_references || '[]'),  // Phase 6: Always include references
      content: includeContent ? JSON.parse(row.content) : null,
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * List all files for a company
   * @param company_id - The company ID for tenant isolation (REQUIRED for security)
   * @param typeFilter - Optional file type filter
   * @param pathFilters - Optional array of path prefixes to filter by (e.g., ['/org', '/team'])
   * @param depth - Optional depth for hierarchical filtering (1 = direct children, 2 = children + grandchildren, -1 = all descendants)
   * @param includeContent - Whether to include content field (defaults to true)
   */
  static async listAll(
    company_id: number,
    typeFilter?: string,
    pathFilters?: string[],
    depth?: number,
    includeContent: boolean = true
  ): Promise<DbFile[]> {
    const db = await getAdapter();
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [company_id];
    let paramIndex = 2;

    // Add type filter
    if (typeFilter) {
      conditions.push(`type = $${paramIndex}`);
      params.push(typeFilter);
      paramIndex++;
    }

    // Add path filters with depth support
    if (pathFilters && pathFilters.length > 0) {
      const pathConditions: string[] = [];

      for (const folderPath of pathFilters) {
        // Special case: root folder includes all files
        if (folderPath === '/') {
          pathConditions.push('1=1');
          continue;
        }

        if (depth === -1) {
          // All descendants: simple prefix match
          pathConditions.push(`path LIKE $${paramIndex}`);
          params.push(`${folderPath}/%`);
          paramIndex++;
        } else if (depth && depth > 0) {
          // Specific depth: use slash-counting
          // Calculate base slash count in the folder path
          const baseSlashCount = (folderPath.match(/\//g) || []).length;
          const maxSlashCount = baseSlashCount + depth;

          pathConditions.push(
            `(path LIKE $${paramIndex} AND (length(path) - length(replace(path, '/', ''))) <= $${paramIndex + 1})`
          );
          params.push(`${folderPath}/%`, maxSlashCount);
          paramIndex += 2;
        } else {
          // No depth specified: simple prefix match
          pathConditions.push(`path LIKE $${paramIndex}`);
          params.push(`${folderPath}/%`);
          paramIndex++;
        }
      }

      if (pathConditions.length > 0) {
        conditions.push(`(${pathConditions.join(' OR ')})`);
      }
    }

    // Select only metadata columns when includeContent is false (Phase 6: file_references always included)
    const columns = includeContent
      ? '*'
      : 'id, name, path, type, file_references, company_id, created_at, updated_at';

    const sql = `SELECT ${columns} FROM files WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`;
    const result = await db.query<DbRow>(sql, params);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type,
      references: JSON.parse(row.file_references || '[]'),  // Phase 6: Always include references
      content: includeContent ? JSON.parse(row.content) : null,
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  /**
   * Update a file by integer ID
   * @param references - Pre-extracted references from client (Phase 6: server is dumb)
   * @param company_id - The company ID for tenant isolation (REQUIRED for security)
   */
  static async update(id: number, name: string, path: string, content: BaseFileContent, references: number[], company_id: number): Promise<boolean> {
    const db = await getAdapter();

    // Phase 6: Server is dumb - client sends pre-extracted references
    const result = await db.query(
      'UPDATE files SET name = $1, path = $2, content = $3, file_references = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 AND company_id = $6',
      [name, path, JSON.stringify(content), JSON.stringify(references), id, company_id]
    );

    return result.rowCount > 0;
  }

  /**
   * Update only file metadata (name and/or path) without modifying content
   * @param id - File ID
   * @param name - New file name
   * @param path - New file path
   * @param company_id - The company ID for tenant isolation (REQUIRED for security)
   * @returns true if updated, false if file not found
   */
  static async updateMetadata(id: number, name: string, path: string, company_id: number): Promise<boolean> {
    const db = await getAdapter();
    const result = await db.query(
      'UPDATE files SET name = $1, path = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND company_id = $4',
      [name, path, id, company_id]
    );

    return result.rowCount > 0;
  }

  /**
   * Delete a file by integer ID
   * @param company_id - The company ID for tenant isolation (REQUIRED for security)
   */
  static async delete(id: number, company_id: number): Promise<boolean> {
    const db = await getAdapter();
    const result = await db.query('DELETE FROM files WHERE id = $1 AND company_id = $2', [id, company_id]);

    return result.rowCount > 0;
  }

  /**
   * Update the path of a file by integer ID
   * @param company_id - The company ID for tenant isolation (REQUIRED for security)
   */
  static async updatePath(id: number, newPath: string, company_id: number): Promise<boolean> {
    const db = await getAdapter();
    const result = await db.query('UPDATE files SET path = $1 WHERE id = $2 AND company_id = $3', [newPath, id, company_id]);

    return result.rowCount > 0;
  }
}

/**
 * Type for raw access token row from database
 * Schema v2: token is PRIMARY KEY (no separate id column)
 */
interface DbAccessTokenRow {
  token: string;
  company_id: number;
  file_id: number;
  view_as_user_id: number;
  created_by_user_id: number;
  created_at: string;
  expires_at: string;
  is_active: number;  // SQLite stores boolean as 0/1
}

/**
 * AccessTokenDB - Database operations for access tokens
 * Manages public file sharing via token-based access
 */
export class AccessTokenDB {
  /**
   * Create a new access token for public file sharing
   * @param file_id - File to expose
   * @param view_as_user_id - User whose permissions to use
   * @param company_id - Company ID for multi-tenant isolation
   * @param created_by_user_id - Admin creating the token
   * @param expires_at - Optional expiration (defaults to 30 days from now)
   * @returns The generated token string (UUID)
   */
  static async create(
    file_id: number,
    view_as_user_id: number,
    company_id: number,
    created_by_user_id: number,
    expires_at?: string
  ): Promise<string> {
    const db = await getAdapter();
    const token = randomUUID();

    // Default expiration: 30 days from now
    const expirationDate = expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db.query(`
      INSERT INTO access_tokens (token, company_id, file_id, view_as_user_id, created_by_user_id, created_at, expires_at, is_active)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, 1)
    `, [token, company_id, file_id, view_as_user_id, created_by_user_id, expirationDate]);

    return token;
  }

  /**
   * Get an access token by token string
   * @param token - The UUID token string
   * @returns AccessToken or null if not found
   * NOTE: This does NOT filter by company_id because tokens are globally unique
   */
  static async getByToken(token: string): Promise<AccessToken | null> {
    const db = await getAdapter();
    const result = await db.query<DbAccessTokenRow>('SELECT * FROM access_tokens WHERE token = $1', [token]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: 0,  // Schema v2: token is PRIMARY KEY (id field kept for BaseEntity compatibility)
      token: row.token,
      file_id: row.file_id,
      view_as_user_id: row.view_as_user_id,
      company_id: row.company_id,
      created_by_user_id: row.created_by_user_id,
      created_at: row.created_at,
      updated_at: row.created_at,  // Tokens don't have updated_at, use created_at
      expires_at: row.expires_at,
      is_active: row.is_active === 1,
    };
  }

  /**
   * List all tokens for a specific file
   * @param file_id - The file ID
   * @param company_id - Company ID for multi-tenant isolation
   * @returns Array of AccessToken
   */
  static async listByFileId(file_id: number, company_id: number): Promise<AccessToken[]> {
    const db = await getAdapter();
    const result = await db.query<DbAccessTokenRow>('SELECT * FROM access_tokens WHERE company_id = $1 AND file_id = $2 ORDER BY created_at DESC', [company_id, file_id]);

    return result.rows.map((row) => ({
      id: 0,  // Schema v2: token is PRIMARY KEY (id field kept for BaseEntity compatibility)
      token: row.token,
      file_id: row.file_id,
      view_as_user_id: row.view_as_user_id,
      company_id: row.company_id,
      created_by_user_id: row.created_by_user_id,
      created_at: row.created_at,
      updated_at: row.created_at,
      expires_at: row.expires_at,
      is_active: row.is_active === 1,
    }));
  }

  /**
   * Revoke a token (set is_active = false)
   * @param token - The token string (UUID)
   * @param company_id - Company ID for multi-tenant isolation
   * @returns True if token was revoked, false if not found
   */
  static async revoke(token: string, company_id: number): Promise<boolean> {
    const db = await getAdapter();
    const result = await db.query('UPDATE access_tokens SET is_active = 0 WHERE token = $1 AND company_id = $2', [token, company_id]);

    return result.rowCount > 0;
  }


  /**
   * Update token expiration
   * @param token - The token string (UUID)
   * @param company_id - Company ID for multi-tenant isolation
   * @param expires_at - New expiration timestamp (ISO string or null for no expiration)
   * @returns True if updated, false if not found
   */
  static async updateExpiration(token: string, company_id: number, expires_at: string | null): Promise<boolean> {
    const db = await getAdapter();
    const result = await db.query('UPDATE access_tokens SET expires_at = $1 WHERE token = $2 AND company_id = $3', [expires_at, token, company_id]);

    return result.rowCount > 0;
  }

  /**
   * Validate token is usable (active and not expired)
   * @param token - AccessToken object
   * @returns Object with isValid flag and optional error message
   */
  static validateToken(token: AccessToken): { isValid: boolean; error?: string } {
    if (!token.is_active) {
      return { isValid: false, error: 'Token has been revoked' };
    }

    const now = new Date();
    const expiresAt = new Date(token.expires_at);

    if (now > expiresAt) {
      return { isValid: false, error: 'Token has expired' };
    }

    return { isValid: true };
  }

  /**
   * Delete expired tokens (cleanup job)
   * @returns Number of tokens deleted
   */
  static async cleanupExpired(): Promise<number> {
    const db = await getAdapter();
    const result = await db.query('DELETE FROM access_tokens WHERE expires_at < CURRENT_TIMESTAMP', []);

    return result.rowCount;
  }
}
