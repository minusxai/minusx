/**
 * Config DB helpers — read/write system configuration from the configs table.
 *
 * Two call patterns:
 *   getConfigValue(key)      — normal server request: routes through getModules().db
 *   getConfigValue(key, tx)  — inside a transaction (import-export, migrate-db routes): uses the
 *                              passed IDatabaseAdapter or ITransactionContext directly
 */
import { getModules } from '@/lib/modules/registry';
import { QueryResult } from './adapter/types';
import { IDatabaseAdapter, ITransactionContext } from './adapter/types';

type QueryContext = IDatabaseAdapter | ITransactionContext;

function resolveExec(db?: QueryContext): (sql: string, params?: any[]) => Promise<QueryResult<any>> {
  if (db) return (sql, params) => db.query(sql, params);
  return (sql, params) => getModules().db.exec(sql, params);
}

export async function getConfigValue(key: string, db?: QueryContext): Promise<string | null> {
  const exec = resolveExec(db);
  try {
    const result = await exec('SELECT value FROM configs WHERE key = $1', [key]);
    return result.rows[0]?.value || null;
  } catch (error: any) {
    if (error.message && error.message.includes('no such table')) return null;
    throw error;
  }
}

export async function setConfigValue(key: string, value: string, db?: QueryContext): Promise<void> {
  const exec = resolveExec(db);
  await exec(
    `INSERT INTO configs (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = $3, updated_at = CURRENT_TIMESTAMP`,
    [key, value, value]
  );
}

export async function getDataVersion(db?: QueryContext): Promise<number> {
  const version = await getConfigValue('data_version', db);
  return version ? parseInt(version, 10) : 0;
}

export async function setDataVersion(version: number, db?: QueryContext): Promise<void> {
  await setConfigValue('data_version', version.toString(), db);
}

export async function getSchemaVersion(db?: QueryContext): Promise<number> {
  const version = await getConfigValue('schema_version', db);
  return version ? parseInt(version, 10) : 0;
}

export async function setSchemaVersion(version: number, db?: QueryContext): Promise<void> {
  await setConfigValue('schema_version', version.toString(), db);
}
