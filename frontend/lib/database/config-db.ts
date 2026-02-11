/**
 * Config database helpers for storing and retrieving system configuration values
 */

import { getAdapter } from './adapter/factory';
import { IDatabaseAdapter } from './adapter/types';

export async function getConfigValue(key: string, db?: IDatabaseAdapter): Promise<string | null> {
  const adapter = db || await getAdapter();
  try {
    const result = await adapter.query<{ value: string }>('SELECT value FROM configs WHERE key = $1', [key]);
    return result.rows[0]?.value || null;
  } catch (error: any) {
    // If configs table doesn't exist, return null (pre-migration database)
    if (error.message && error.message.includes('no such table')) {
      return null;
    }
    throw error;
  }
}

export async function setConfigValue(key: string, value: string, db?: IDatabaseAdapter): Promise<void> {
  const adapter = db || await getAdapter();
  await adapter.query(`
    INSERT INTO configs (key, value, updated_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = $3, updated_at = CURRENT_TIMESTAMP
  `, [key, value, value]);
}

export async function getDataVersion(db?: IDatabaseAdapter): Promise<number> {
  const version = await getConfigValue('data_version', db);
  return version ? parseInt(version, 10) : 0;
}

export async function setDataVersion(version: number, db?: IDatabaseAdapter): Promise<void> {
  await setConfigValue('data_version', version.toString(), db);
}

export async function getSchemaVersion(db?: IDatabaseAdapter): Promise<number> {
  const version = await getConfigValue('schema_version', db);
  return version ? parseInt(version, 10) : 0;
}

export async function setSchemaVersion(version: number, db?: IDatabaseAdapter): Promise<void> {
  await setConfigValue('schema_version', version.toString(), db);
}
