import { getDbType } from '../lib/database/db-config';
import { createAdapter } from '../lib/database/adapter/factory';
import { setDataVersion, setSchemaVersion } from '../lib/database/config-db';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION } from '../lib/database/constants';

export async function createEmptyDatabase(_dbPath: string = '') {
  const dbType = getDbType();

  const db = dbType === 'pglite'
    ? await createAdapter({ type: 'pglite' })
    : await createAdapter({ type: 'postgres', postgresConnectionString: process.env.POSTGRES_URL });

  await db.initializeSchema();
  await setDataVersion(LATEST_DATA_VERSION, db);
  await setSchemaVersion(LATEST_SCHEMA_VERSION, db);
  await db.close();
}
