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

async function getConfigValue(key: string, db?: QueryContext): Promise<string | null> {
  const exec = resolveExec(db);
  try {
    const result = await exec('SELECT value FROM configs WHERE key = $1', [key]);
    return result.rows[0]?.value || null;
  } catch (error: any) {
    if (error.message && error.message.includes('no such table')) return null;
    throw error;
  }
}

async function setConfigValue(key: string, value: string, db?: QueryContext): Promise<void> {
  const exec = resolveExec(db);
  await exec(
    // Target the primary key by NAME, not by column list. `ON CONFLICT (key)` has to
    // match a unique index exactly, so it breaks anywhere the PK carries extra
    // scoping columns; the constraint name resolves to whatever the PK actually is.
    `INSERT INTO configs (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT ON CONSTRAINT configs_pkey DO UPDATE SET value = $3, updated_at = CURRENT_TIMESTAMP`,
    [key, value, value]
  );
}

/**
 * The workspace's data version.
 *
 * Stored in `public_data` rather than `configs` because a deployment serving several
 * workspaces has to answer "what is the oldest version any of them is on?" before
 * knowing which workspace a request belongs to — and namespace-scoped storage cannot be
 * read at that point.
 *
 * Falls back to `configs` for workspaces written before the move; the fallback can go
 * once no deployment still holds the old row.
 */
export async function getDataVersion(db?: QueryContext): Promise<number> {
  const exec = resolveExec(db);
  try {
    const result = await exec(`SELECT value FROM public_data WHERE key = 'data_version'`);
    const v = result.rows[0]?.value;
    if (v) return parseInt(v, 10);
  } catch { /* table absent on an un-migrated database — fall through */ }

  const legacy = await getConfigValue('data_version', db);
  return legacy ? parseInt(legacy, 10) : 0;
}

export async function setDataVersion(version: number, db?: QueryContext): Promise<void> {
  const exec = resolveExec(db);
  await exec(
    `INSERT INTO public_data (key, value, updated_at) VALUES ('data_version', $1, CURRENT_TIMESTAMP)
     ON CONFLICT ON CONSTRAINT public_data_pkey DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
    [version.toString(), version.toString()],
  );
}

export async function getSchemaVersion(db?: QueryContext): Promise<number> {
  const version = await getConfigValue('schema_version', db);
  return version ? parseInt(version, 10) : 0;
}

export async function setSchemaVersion(version: number, db?: QueryContext): Promise<void> {
  await setConfigValue('schema_version', version.toString(), db);
}
