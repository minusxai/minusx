/**
 * Per-company ID generation
 * Simulates AUTO_INCREMENT behavior within company scope
 */

import { IDatabaseAdapter } from './adapter/types';

/**
 * Generate next ID for a table within a company
 * Uses MAX(id) + 1 pattern for per-company sequences
 *
 * @param db - Database adapter
 * @param table - Table name ('users' or 'files')
 * @param companyId - Company ID for scoping
 * @returns Next available ID for this company in this table
 */
export async function getNextId(
  db: IDatabaseAdapter,
  table: 'users' | 'files',
  companyId: number
): Promise<number> {
  const result = await db.query<{ next_id: number }>(`
    SELECT COALESCE(MAX(id), 0) + 1 AS next_id
    FROM ${table}
    WHERE company_id = $1
  `, [companyId]);

  return result.rows[0].next_id;
}
