// End-to-end: saving a connection through FilesAPI.createFile must move the raw credential
// to the secrets table — the persisted DOCUMENT (what the agent/markup sees) holds only a
// @SECRETS/… ref. Query-time resolution recovers the real value.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { createFile } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { SecretsDB } from '../secrets-db.server';
import { resolveConnectionSecrets } from '../connection-secrets.server';
import { isSecretRef } from '../secret-refs';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConnectionContent } from '@/lib/types';

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));

const user: EffectiveUser = {
  userId: 1, email: 't@e.com', name: 'T', role: 'admin', home_folder: '/org', mode: 'org',
};

describe('connection save → secrets boundary (e2e)', () => {
  const dbPath = getTestDbPath('connection_secrets_e2e');
  beforeAll(async () => {
    await initTestDatabase(dbPath);
    for (const [name, p] of [['org', '/org'], ['database', '/org/database']] as const) {
      if (!(await DocumentDB.getByPath(p))) {
        await DocumentDB.create(name, p, 'folder', { name }, [], undefined, false);
      }
    }
  });
  afterAll(async () => { await cleanupTestDatabase(dbPath); });

  it('persists a @SECRETS ref in the document; raw value lives only in the secrets table', async () => {
    const res = await createFile({
      name: 'saas_metrics',
      path: '/org/database/saas_metrics',
      type: 'connection',
      content: { type: 'postgresql', config: { host: 'db.internal', port: 5432, password: 'hunter2' } } as ConnectionContent,
    }, user);

    // What's persisted in the DOCUMENT (this is what the agent/markup/client can see):
    const stored = await DocumentDB.getById(res.data.id);
    const cfg = (stored!.content as ConnectionContent).config;
    expect(cfg.host).toBe('db.internal');           // non-secret stays
    expect(cfg.port).toBe(5432);
    expect(isSecretRef(cfg.password)).toBe(true);    // secret is a ref…
    expect(cfg.password).not.toBe('hunter2');        // …never the raw value
    expect(JSON.stringify(stored!.content)).not.toContain('hunter2'); // belt-and-suspenders

    // The raw value lives ONLY in the server-only secrets table.
    expect(await SecretsDB.get(cfg.password as string)).toBe('hunter2');

    // Query-time resolution recovers it (server-side only).
    const resolved = await resolveConnectionSecrets(cfg);
    expect(resolved.password).toBe('hunter2');
  });
});
