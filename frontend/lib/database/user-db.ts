/**
 * User management — CRUD for the users table.
 */
import { getModules } from '@/lib/modules/registry';
import { getDbType } from './db-config';
import { UserRole } from '../types';
import { isAdmin } from '../auth/role-helpers';

export interface User {
  id: number;
  email: string;
  name: string;
  password_hash: string | null;
  phone: string | null;
  state: string | null;
  home_folder: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

/**
 * Validate and normalize home_folder based on role.
 * Admins always get "" (mode root). Non-admins get a relative path.
 */
export function validateAndNormalizeHomeFolder(home_folder: string, role: UserRole): string {
  if (isAdmin(role)) return '';
  const normalized = home_folder.replace(/^\/+|\/+$/g, '');
  if (normalized.startsWith('/')) {
    throw new Error('Non-admin users must have relative home_folder (e.g., "sales/team1")');
  }
  return normalized;
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string | null;
  phone: string | null;
  state: string | null;
  home_folder: string;
  role: string;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    password_hash: row.password_hash,
    phone: row.phone,
    state: row.state,
    home_folder: row.home_folder,
    role: row.role as UserRole,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class UserDB {
  static async create(
    email: string,
    name: string,
    home_folder: string,
    options: {
      password_hash?: string;
      phone?: string;
      state?: string;
      role?: UserRole;
    } = {}
  ): Promise<number> {
    const db = getModules().db;
    const dbType = getDbType();
    const role = options.role || 'viewer';
    const normalizedHomeFolder = validateAndNormalizeHomeFolder(home_folder, role);

    if (dbType === 'postgres' || dbType === 'pglite') {
      const result = await db.exec<{ id: number }>(`
        WITH lock AS (
          SELECT pg_advisory_xact_lock(2) AS lock_acquired
        ),
        next_id_gen AS (
          SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM users
        )
        INSERT INTO users (id, email, name, password_hash, phone, state, home_folder, role, created_at, updated_at)
        SELECT next_id, $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM next_id_gen, lock
        RETURNING id
      `, [email, name, options.password_hash || null, options.phone || null, options.state || null, normalizedHomeFolder, role]);
      return result.rows[0].id;
    } else {
      const result = await db.exec<{ id: number }>(`
        WITH next_id_gen AS (
          SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM users
        )
        INSERT INTO users (id, email, name, password_hash, phone, state, home_folder, role, created_at, updated_at)
        SELECT next_id, $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM next_id_gen
        RETURNING id
      `, [email, name, options.password_hash || null, options.phone || null, options.state || null, normalizedHomeFolder, role]);
      return result.rows[0].id;
    }
  }

  static async getById(id: number): Promise<User | null> {
    const result = await getModules().db.exec<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? rowToUser(row) : null;
  }

  /** Look up user by email. */
  static async getByEmail(email: string): Promise<User | null> {
    const result = await getModules().db.exec<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    const row = result.rows[0];
    return row ? rowToUser(row) : null;
  }

  static async listAll(): Promise<User[]> {
    const result = await getModules().db.exec<UserRow>('SELECT * FROM users ORDER BY name ASC', []);
    return result.rows.map(rowToUser);
  }

  static async update(
    id: number,
    data: {
      email?: string;
      name?: string;
      password_hash?: string | null;
      phone?: string | null;
      state?: string | null;
      home_folder?: string;
      role?: UserRole;
    }
  ): Promise<void> {
    const currentUser = await this.getById(id);
    if (!currentUser) throw new Error(`User with id ${id} not found`);

    const finalRole = data.role !== undefined ? data.role : currentUser.role;

    let normalizedHomeFolder = data.home_folder;
    if (data.home_folder !== undefined) {
      normalizedHomeFolder = validateAndNormalizeHomeFolder(data.home_folder, finalRole);
    } else if (data.role !== undefined && data.role !== currentUser.role) {
      normalizedHomeFolder = validateAndNormalizeHomeFolder(currentUser.home_folder, finalRole);
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.email !== undefined) { fields.push(`email = $${paramIndex++}`); values.push(data.email); }
    if (data.name !== undefined) { fields.push(`name = $${paramIndex++}`); values.push(data.name); }
    if (data.password_hash !== undefined) { fields.push(`password_hash = $${paramIndex++}`); values.push(data.password_hash); }
    if (data.phone !== undefined) { fields.push(`phone = $${paramIndex++}`); values.push(data.phone); }
    if (data.state !== undefined) { fields.push(`state = $${paramIndex++}`); values.push(data.state); }
    if (normalizedHomeFolder !== undefined) { fields.push(`home_folder = $${paramIndex++}`); values.push(normalizedHomeFolder); }
    if (data.role !== undefined) { fields.push(`role = $${paramIndex++}`); values.push(data.role); }

    if (fields.length === 0) return;
    values.push(id);

    await getModules().db.exec(`UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex}`, values);
  }

  static async delete(id: number): Promise<void> {
    await getModules().db.exec('DELETE FROM users WHERE id = $1', [id]);
  }

  static async emailExists(email: string, excludeId?: number): Promise<boolean> {
    const result = excludeId !== undefined
      ? await getModules().db.exec<{ id: number }>('SELECT id FROM users WHERE email = $1 AND id != $2', [email, excludeId])
      : await getModules().db.exec<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
    return result.rows.length > 0;
  }
}
