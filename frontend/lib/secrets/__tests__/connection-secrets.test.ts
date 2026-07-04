// Connection secrets: raw credentials are moved to the server-only `secrets` table on
// save (config keeps a @SECRETS/… ref) and resolved back only at query time.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { isSecretField, isSecretRef, connectionSecretPath, SECRET_REF_PREFIX } from '../secret-refs';
import { extractConnectionSecrets, resolveConnectionSecrets } from '../connection-secrets.server';
import { SecretsDB } from '../secrets-db.server';

describe('secret-refs (pure helpers)', () => {
  it('flags credential-ish field names, not plain ones', () => {
    for (const f of ['password', 'service_account_json', 'secret_access_key', 'api_key', 'private_key', 'access_token'])
      expect(isSecretField(f)).toBe(true);
    for (const f of ['host', 'port', 'database', 'project_id', 'dataset', 'region', 'schema'])
      expect(isSecretField(f)).toBe(false);
  });

  it('recognises a @SECRETS/ ref and builds canonical paths', () => {
    expect(isSecretRef('@SECRETS/connections/db/password')).toBe(true);
    expect(isSecretRef('hunter2')).toBe(false);
    expect(connectionSecretPath('saas_metrics', 'password')).toBe(`${SECRET_REF_PREFIX}connections/saas_metrics/password`);
  });
});

describe('extract / resolve (through the secrets table)', () => {
  const dbPath = getTestDbPath('connection_secrets');
  beforeAll(async () => { await initTestDatabase(dbPath); });
  afterAll(async () => { await cleanupTestDatabase(dbPath); });

  it('extract moves raw secrets to the store and leaves a ref; non-secrets untouched', async () => {
    const config = { host: 'db.internal', port: 5432, database: 'analytics', password: 'hunter2' };
    const out = await extractConnectionSecrets('saas_metrics', config);

    expect(out.host).toBe('db.internal');
    expect(out.port).toBe(5432);
    expect(out.password).toBe('@SECRETS/connections/saas_metrics/password'); // ref, not the value
    // The raw value lives ONLY in the store.
    expect(await SecretsDB.get('@SECRETS/connections/saas_metrics/password')).toBe('hunter2');
  });

  it('round-trips: resolve swaps the ref back to the raw value', async () => {
    const stored = await extractConnectionSecrets('pg', { host: 'h', password: 'p@ss<w>ord', service_account_json: '{"k":1}' });
    expect(isSecretRef(stored.password)).toBe(true);
    expect(isSecretRef(stored.service_account_json)).toBe(true);

    const resolved = await resolveConnectionSecrets(stored);
    expect(resolved.password).toBe('p@ss<w>ord');
    expect(resolved.service_account_json).toBe('{"k":1}');
    expect(resolved.host).toBe('h');
  });

  it('does NOT double-extract an existing ref, and updates the value on change', async () => {
    const first = await extractConnectionSecrets('c', { password: 'v1' });
    // Re-saving with the ref already in place must not store the literal "@SECRETS/…".
    const again = await extractConnectionSecrets('c', { password: first.password });
    expect(again.password).toBe(first.password);
    expect(await SecretsDB.get(first.password as string)).toBe('v1');
    // A real new value overwrites.
    const changed = await extractConnectionSecrets('c', { password: 'v2' });
    expect(await SecretsDB.get(changed.password as string)).toBe('v2');
  });

  it('resolve passes a legacy raw value through untouched (no ref, no store entry)', async () => {
    const resolved = await resolveConnectionSecrets({ host: 'h', password: 'legacy-raw' });
    expect(resolved.password).toBe('legacy-raw'); // backward compatible
  });
});
