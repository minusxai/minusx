/**
 * DB connections in CONFIG — infrastructure managed like LLM providers
 * (Settings → Databases over the org config's `databases` section), not as
 * files. Locked here:
 *
 *  1. Credentials in the databases section are EXTRACTED to `@SECRETS/…` refs
 *     on config save (the same machinery as llm.providers.apiKey) — the doc
 *     never stores a raw password.
 *  2. ConnectionsAPI resolves config entries by name — getRawByName works with
 *     NO /database doc, and a config entry WINS over a same-named legacy doc
 *     (names stay byte-identical through migration, so contexts/questions/
 *     Views keep resolving).
 *  3. listAll merges config + legacy file connections (no duplicates).
 */
import { FilesAPI } from '@/lib/data/files.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { validateDatabasesConfig } from '@/lib/config/database-config-types';
import { isSecretRef } from '@/lib/secrets/secret-refs';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('config_databases');
const ADMIN: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };

async function mk(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const pgEntry = (name: string, password = 'hunter2') => ({
  name, type: 'postgresql',
  config: { host: 'db.internal', port: 5432, database: 'app', username: 'svc', password },
});

describe('validateDatabasesConfig (pure)', () => {
  it('accepts a well-formed section and rejects malformed ones', () => {
    expect(validateDatabasesConfig({ connections: [pgEntry('wh')] })).toBeNull();
    expect(validateDatabasesConfig({ connections: [pgEntry('a'), pgEntry('a')] })).toMatch(/duplicate/);
    expect(validateDatabasesConfig({ connections: [{ name: '', type: 'postgresql', config: {} }] })).toMatch(/name/);
    expect(validateDatabasesConfig(null)).toMatch(/object/);
  });
});

describe('databases config: secrets + resolution (real save path)', () => {
  setupTestDb(TEST_DB_PATH);

  let configId: number;

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    configId = await mk('config', '/org/configs/config', 'config', {});
  });

  it('saving the config EXTRACTS connection passwords to @SECRETS refs', async () => {
    await FilesAPI.saveFile(configId, 'config', '/org/configs/config', {
      databases: { connections: [pgEntry('warehouse')] },
    } as never, [], ADMIN);

    const doc = await DocumentDB.getById(configId);
    const stored = (doc!.content as { databases: { connections: Array<{ config: Record<string, unknown> }> } }).databases.connections[0];
    expect(isSecretRef(stored.config.password)).toBe(true);   // never raw at rest
    expect(stored.config.host).toBe('db.internal');           // non-secrets verbatim
  });

  it('getRawByName resolves a config-backed connection with NO /database doc', async () => {
    await FilesAPI.saveFile(configId, 'config', '/org/configs/config', {
      databases: { connections: [pgEntry('warehouse')] },
    } as never, [], ADMIN);

    const raw = await ConnectionsAPI.getRawByName('warehouse', 'org');
    expect(raw.type).toBe('postgresql');
    expect(raw.config.host).toBe('db.internal');
  });

  it('a config entry WINS over a same-named legacy /database doc', async () => {
    await mk('warehouse', '/org/database/warehouse', 'connection', {
      type: 'clickhouse', config: { host: 'old.internal' },
    });
    await FilesAPI.saveFile(configId, 'config', '/org/configs/config', {
      databases: { connections: [pgEntry('warehouse')] },
    } as never, [], ADMIN);

    const raw = await ConnectionsAPI.getRawByName('warehouse', 'org');
    expect(raw.type).toBe('postgresql'); // config is the source of truth
  });

  it('listAll merges config + legacy connections without duplicates', async () => {
    await mk('legacy', '/org/database/legacy', 'connection', {
      type: 'clickhouse', config: { host: 'old.internal' },
    });
    await FilesAPI.saveFile(configId, 'config', '/org/configs/config', {
      databases: { connections: [pgEntry('warehouse'), pgEntry('legacy', 'x')] },
    } as never, [], ADMIN);

    const { connections } = await ConnectionsAPI.listAll(ADMIN);
    const names = connections.map((c) => c.name).sort();
    expect(names).toEqual(['legacy', 'warehouse']);
    expect(connections.find((c) => c.name === 'legacy')?.type).toBe('postgresql'); // config wins
  });
});
