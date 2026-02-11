/**
 * SQLite database module for user management.
 * Handles CRUD operations for users in multi-tenant architecture.
 */
import { getAdapter } from './adapter/factory';
import { IDatabaseAdapter } from './adapter/types';
import { UserRole } from '../types';
import { isAdmin } from '../auth/role-helpers';

export interface User {
  id: number;
  email: string;
  name: string;
  password_hash: string | null;
  phone: string | null;
  state: string | null;  // JSON string storing UserState
  home_folder: string;
  role: UserRole;
  company_id: number;
  created_at: string;
  updated_at: string;
}

/**
 * Validate and normalize home_folder based on role
 * - Admins: Always "" (mode root - sees everything in current mode)
 * - Non-admins (editor/viewer): Relative path (e.g., "sales/team1") or "" for mode root
 *
 * NOTE: home_folder is now stored as relative path (no mode prefix)
 * Will be resolved at runtime with mode: resolveHomeFolder(mode, home_folder)
 */
export function validateAndNormalizeHomeFolder(home_folder: string, role: UserRole): string {
  // Admins always get mode root (full access within their current mode)
  if (isAdmin(role)) {
    return '';
  }

  // Non-admins get relative path (e.g., "sales/team1" or "" for mode root)
  // Remove any leading/trailing slashes
  const normalized = home_folder.replace(/^\/+|\/+$/g, '');

  // Reject absolute paths (must be relative)
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
  company_id: number;
  created_at: string;
  updated_at: string;
}

/**
 * Helper to get the next ID for a given table and company
 */
async function getNextId(adapter: IDatabaseAdapter, tableName: string, companyId: number): Promise<number> {
  const result = await adapter.query<{ max_id: number | null }>(
    `SELECT MAX(id) as max_id FROM ${tableName} WHERE company_id = $1`,
    [companyId]
  );
  const maxId = result.rows[0]?.max_id;
  return (maxId ?? 0) + 1;
}

export class UserDB {
  /**
   * Create a new user
   * @returns The per-company generated integer ID
   */
  static async create(
    email: string,
    name: string,
    company_id: number,
    home_folder: string,
    options: {
      password_hash?: string;
      phone?: string;
      state?: string;
      role?: UserRole;
      db?: IDatabaseAdapter;
    } = {}
  ): Promise<number> {
    const adapter = options.db || await getAdapter();

    const role = options.role || 'viewer';  // Default to viewer
    const normalizedHomeFolder = validateAndNormalizeHomeFolder(home_folder, role);

    // Get next ID for this company
    const nextId = await getNextId(adapter, 'users', company_id);

    await adapter.query(
      `INSERT INTO users (company_id, id, email, name, password_hash, phone, state, home_folder, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        company_id,
        nextId,
        email,
        name,
        options.password_hash || null,
        options.phone || null,
        options.state || null,
        normalizedHomeFolder,
        role
      ]
    );

    return nextId;
  }

  /**
   * Get a user by ID (requires company_id for composite key)
   */
  static async getById(id: number, company_id: number, db?: IDatabaseAdapter): Promise<User | null> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<UserRow>(
      'SELECT * FROM users WHERE company_id = $1 AND id = $2',
      [company_id, id]
    );
    const row = result.rows[0];

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      password_hash: row.password_hash,
      phone: row.phone,
      state: row.state,
      home_folder: row.home_folder,
      role: row.role as UserRole,
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Get a user by email (within their company)
   */
  static async getByEmailAndCompany(email: string, company_id: number, db?: IDatabaseAdapter): Promise<User | null> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<UserRow>(
      'SELECT * FROM users WHERE email = $1 AND company_id = $2',
      [email, company_id]
    );
    const row = result.rows[0];

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      password_hash: row.password_hash,
      phone: row.phone,
      state: row.state,
      home_folder: row.home_folder,
      role: row.role as UserRole,
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * List all users for a company
   */
  static async listByCompany(company_id: number, db?: IDatabaseAdapter): Promise<User[]> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<UserRow>(
      'SELECT * FROM users WHERE company_id = $1 ORDER BY name ASC',
      [company_id]
    );

    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      password_hash: row.password_hash,
      phone: row.phone,
      state: row.state,
      home_folder: row.home_folder,
      role: row.role as UserRole,
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  /**
   * List all users (admin only)
   */
  static async listAll(db?: IDatabaseAdapter): Promise<User[]> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<UserRow>(
      'SELECT * FROM users ORDER BY company_id, name ASC',
      []
    );

    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      password_hash: row.password_hash,
      phone: row.phone,
      state: row.state,
      home_folder: row.home_folder,
      role: row.role as UserRole,
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  /**
   * Update a user (requires company_id for composite key)
   */
  static async update(
    id: number,
    company_id: number,
    data: {
      email?: string;
      name?: string;
      password_hash?: string | null;
      phone?: string | null;
      state?: string | null;
      home_folder?: string;
      role?: UserRole;
      db?: IDatabaseAdapter;
    }
  ): Promise<void> {
    const adapter = data.db || await getAdapter();

    // Get current user to determine role for validation
    const currentUser = await this.getById(id, company_id, adapter);
    if (!currentUser) {
      throw new Error(`User with id ${id} in company ${company_id} not found`);
    }

    // Determine final role (use updated value if provided, otherwise keep current)
    const finalRole = data.role !== undefined ? data.role : currentUser.role;

    // Validate and normalize home_folder if being updated
    let normalizedHomeFolder = data.home_folder;
    if (data.home_folder !== undefined) {
      normalizedHomeFolder = validateAndNormalizeHomeFolder(data.home_folder, finalRole);
    } else if (data.role !== undefined && data.role !== currentUser.role) {
      // Role is changing but home_folder not explicitly set
      // Normalize current home_folder with new role
      normalizedHomeFolder = validateAndNormalizeHomeFolder(currentUser.home_folder, finalRole);
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.email !== undefined) {
      fields.push(`email = $${paramIndex++}`);
      values.push(data.email);
    }
    if (data.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.password_hash !== undefined) {
      fields.push(`password_hash = $${paramIndex++}`);
      values.push(data.password_hash);
    }
    if (data.phone !== undefined) {
      fields.push(`phone = $${paramIndex++}`);
      values.push(data.phone);
    }
    if (data.state !== undefined) {
      fields.push(`state = $${paramIndex++}`);
      values.push(data.state);
    }
    if (normalizedHomeFolder !== undefined) {
      fields.push(`home_folder = $${paramIndex++}`);
      values.push(normalizedHomeFolder);
    }
    if (data.role !== undefined) {
      fields.push(`role = $${paramIndex++}`);
      values.push(data.role);
    }

    if (fields.length === 0) return;

    values.push(company_id, id);

    const sql = `UPDATE users SET ${fields.join(', ')} WHERE company_id = $${paramIndex++} AND id = $${paramIndex++}`;
    await adapter.query(sql, values);
  }

  /**
   * Delete a user (requires company_id for composite key)
   */
  static async delete(id: number, company_id: number, db?: IDatabaseAdapter): Promise<void> {
    const adapter = db || await getAdapter();
    await adapter.query('DELETE FROM users WHERE company_id = $1 AND id = $2', [company_id, id]);
  }

  /**
   * Check if an email exists within a company
   */
  static async emailExists(email: string, company_id: number, excludeId?: number, db?: IDatabaseAdapter): Promise<boolean> {
    const adapter = db || await getAdapter();
    let result;

    if (excludeId !== undefined) {
      result = await adapter.query<{ id: number }>(
        'SELECT id FROM users WHERE email = $1 AND company_id = $2 AND id != $3',
        [email, company_id, excludeId]
      );
    } else {
      result = await adapter.query<{ id: number }>(
        'SELECT id FROM users WHERE email = $1 AND company_id = $2',
        [email, company_id]
      );
    }

    return result.rows.length > 0;
  }
}
