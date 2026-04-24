import { DBModule } from '../lib/modules/db';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION } from '../lib/database/constants';

export async function createEmptyDatabase(_dbPath: string = '') {
  const db = new DBModule();
  await db.init();
  await db.exec(
    `INSERT INTO configs (key, value, updated_at) VALUES ('data_version', $1, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
    [String(LATEST_DATA_VERSION), String(LATEST_DATA_VERSION)]
  );
  await db.exec(
    `INSERT INTO configs (key, value, updated_at) VALUES ('schema_version', $1, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
    [String(LATEST_SCHEMA_VERSION), String(LATEST_SCHEMA_VERSION)]
  );
}
