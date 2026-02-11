/**
 * SQLite database module for company management.
 * Handles CRUD operations for companies in multi-tenant architecture.
 */
import { getAdapter } from './adapter/factory';
import { IDatabaseAdapter } from './adapter/types';
import { BaseEntity } from '@/lib/types';

/**
 * Company entity
 * Extends BaseEntity with company-specific fields
 */
export interface Company extends BaseEntity {
  name: string;
  display_name: string;
  subdomain: string | null;
}

export class CompanyDB {
  /**
   * Create a new company
   * @returns The auto-generated integer ID
   */
  static async create(name: string, display_name: string, subdomain?: string, db?: IDatabaseAdapter): Promise<number> {
    const adapter = db || await getAdapter();

    await adapter.query(
      'INSERT INTO companies (name, display_name, subdomain) VALUES ($1, $2, $3)',
      [name, display_name, subdomain || null]
    );

    const result = await adapter.query<{ id: number }>(
      'SELECT last_insert_rowid() as id',
      []
    );
    return result.rows[0].id;
  }

  /**
   * Get a company by ID
   */
  static async getById(id: number, db?: IDatabaseAdapter): Promise<Company | null> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<Company>('SELECT * FROM companies WHERE id = $1', [id]);
    const row = result.rows[0];

    if (!row) return null;

    return row;
  }

  /**
   * Get a company by name (used for login)
   */
  static async getByName(name: string, db?: IDatabaseAdapter): Promise<Company | null> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<Company>('SELECT * FROM companies WHERE name = $1', [name]);
    const row = result.rows[0];

    if (!row) return null;

    return row;
  }

  /**
   * Get a company by subdomain (for future subdomain routing)
   */
  static async getBySubdomain(subdomain: string, db?: IDatabaseAdapter): Promise<Company | null> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<Company>('SELECT * FROM companies WHERE subdomain = $1', [subdomain]);
    const row = result.rows[0];

    if (!row) return null;

    return row;
  }

  /**
   * List all companies
   */
  static async listAll(db?: IDatabaseAdapter): Promise<Company[]> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<Company>('SELECT * FROM companies ORDER BY name ASC', []);

    return result.rows;
  }

  /**
   * Update a company
   */
  static async update(
    id: number,
    data: {
      name?: string;
      display_name?: string;
      subdomain?: string | null;
      db?: IDatabaseAdapter;
    }
  ): Promise<void> {
    const adapter = data.db || await getAdapter();

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.display_name !== undefined) {
      fields.push(`display_name = $${paramIndex++}`);
      values.push(data.display_name);
    }
    if (data.subdomain !== undefined) {
      fields.push(`subdomain = $${paramIndex++}`);
      values.push(data.subdomain);
    }

    if (fields.length === 0) return;

    values.push(id);

    const sql = `UPDATE companies SET ${fields.join(', ')} WHERE id = $${paramIndex++}`;
    await adapter.query(sql, values);
  }

  /**
   * Delete a company (cascade deletes users and files)
   */
  static async delete(id: number, db?: IDatabaseAdapter): Promise<void> {
    const adapter = db || await getAdapter();
    await adapter.query('DELETE FROM companies WHERE id = $1', [id]);
  }

  /**
   * Check if a company name exists
   */
  static async nameExists(name: string, excludeId?: number, db?: IDatabaseAdapter): Promise<boolean> {
    const adapter = db || await getAdapter();
    let result;

    if (excludeId !== undefined) {
      result = await adapter.query<{ id: number }>(
        'SELECT id FROM companies WHERE name = $1 AND id != $2',
        [name, excludeId]
      );
    } else {
      result = await adapter.query<{ id: number }>(
        'SELECT id FROM companies WHERE name = $1',
        [name]
      );
    }

    return result.rows.length > 0;
  }

  /**
   * Get user count for a company
   */
  static async getUserCount(companyId: number, db?: IDatabaseAdapter): Promise<number> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE company_id = $1',
      [companyId]
    );
    return result.rows[0]?.count || 0;
  }

  /**
   * Get file count for a company
   */
  static async getFileCount(companyId: number, db?: IDatabaseAdapter): Promise<number> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM files WHERE company_id = $1',
      [companyId]
    );
    return result.rows[0]?.count || 0;
  }

  /**
   * Get total count of companies in database
   * Used to check if initial setup is needed
   */
  static async count(db?: IDatabaseAdapter): Promise<number> {
    const adapter = db || await getAdapter();
    const result = await adapter.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM companies',
      []
    );
    return result.rows[0]?.count || 0;
  }

  /**
   * Get the default company in single-tenant mode
   * Returns the latest company (highest ID) if ALLOW_MULTIPLE_COMPANIES=false and companies exist
   * @returns Company object or null if not in single-tenant mode or no companies exist
   */
  static async getDefaultCompany(db?: IDatabaseAdapter): Promise<Company | null> {
    // Check if multiple companies are allowed (default: false)
    const allowMultipleCompanies = process.env.ALLOW_MULTIPLE_COMPANIES === 'true';

    // Only return default company if in single-tenant mode
    if (allowMultipleCompanies) {
      return null;
    }

    const adapter = db || await getAdapter();
    const companies = await this.listAll(adapter);

    if (companies.length === 0) {
      return null;
    }

    // Return the latest company (highest ID)
    return companies.reduce((latest, company) =>
      company.id > latest.id ? company : latest
    );
  }
}
