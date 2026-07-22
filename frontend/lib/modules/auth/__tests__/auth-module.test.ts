/**
 * AuthModule E2E tests.
 *
 * Covers workspace registration — including the tutorial-mode mxfood parquet
 * seed copy. Without that seed step, fresh OSS installs hit "No files found
 * that match the pattern …/csvs/tutorial/mxfood/<table>.parquet" the first
 * time the tutorial connection is queried.
 *
 * Run: npm test -- lib/modules/auth/__tests__/auth-module.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_auth_module.db');

// Spy mock — preserves other exports so atomicImport (which doesn't import this
// module directly) is unaffected, but lets us assert on the seed-copy call.
// `vi.hoisted` lifts the spy alongside the hoisted `vi.mock` factory so it's
// initialized before the factory closure dereferences it.
const { copySeedSpy } = vi.hoisted(() => ({
  copySeedSpy: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/object-store', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, copySeedMxfoodForMode: copySeedSpy };
});

import { AuthModule } from '@/lib/modules/auth';
import { truncateAllTables } from '@/store/__tests__/test-utils';
import { MXFOOD_TABLES } from '@/lib/object-store/mxfood-tables';
import { getModules } from '@/lib/modules/registry';
import { getRawConfig } from '@/lib/data/configs.server';
import { resolveConfigSecrets } from '@/lib/secrets/config-secrets.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import type { LlmConfig } from '@/lib/llm/llm-config-types';

function cleanupDbFiles() {
  [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach((p) => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
}

describe('AuthModule.register', () => {
  beforeEach(async () => {
    cleanupDbFiles();
    await truncateAllTables();
    copySeedSpy.mockClear();
  });

  afterEach(async () => {
    cleanupDbFiles();
    vi.clearAllMocks();
  });

  it('seeds the workspace and triggers mxfood tutorial parquet copy', async () => {
    const mod = new AuthModule();

    const result = await mod.register({
      workspaceName: 'TestCo',
      adminEmail: 'admin@testco.com',
      adminName: 'Admin',
      adminPassword: 'password123',
    });

    expect(result.redirectUrl).toBe('/login');

    // Workspace template should have been imported.
    const db = getModules().db;
    const userResult = await db.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE email = $1',
      ['admin@testco.com'],
    );
    expect(Number(userResult.rows[0].count)).toBe(1);

    const tutorialResult = await db.exec<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE (path = '/tutorial' OR path LIKE '/tutorial/%')",
      [],
    );
    expect(Number(tutorialResult.rows[0].count)).toBeGreaterThan(0);

    // The mxfood seed copy should have been kicked off for tutorial mode with
    // every table the workspace-template's tutorial connection references.
    expect(copySeedSpy).toHaveBeenCalledTimes(1);
    expect(copySeedSpy).toHaveBeenCalledWith('tutorial', MXFOOD_TABLES);
  });

  it('refuses to register a second time', async () => {
    const mod = new AuthModule();

    await mod.register({
      workspaceName: 'TestCo',
      adminEmail: 'admin@testco.com',
      adminName: 'Admin',
      adminPassword: 'password123',
    });

    await expect(
      mod.register({
        workspaceName: 'OtherCo',
        adminEmail: 'other@testco.com',
        adminName: 'Other',
        adminPassword: 'password123',
      }),
    ).rejects.toThrow(/already initialized/i);
  });

  // setup.sh bootstrap: registration optionally carries the LLM config and a
  // first database connection collected by the CLI interview, so the setup
  // wizard's stages are already complete when the user first logs in.
  it('saves a provided llm config into the org config with the key extracted to a secret ref', async () => {
    const mod = new AuthModule();
    await mod.register({
      workspaceName: 'TestCo',
      adminEmail: 'admin@testco.com',
      adminName: 'Admin',
      adminPassword: 'password123',
      llm: {
        providers: [{ name: 'openai', provider: 'openai', apiKey: 'sk-raw-key' }],
        grades: {
          lite: { providerName: 'openai', model: 'gpt-5.4-nano' },
          core: { providerName: 'openai', model: 'gpt-5.4' },
          advanced: { providerName: 'openai', model: 'gpt-5.4' },
        },
      },
    });

    const raw = await getRawConfig('org');
    const llm = raw.llm as LlmConfig;
    expect(llm.providers?.[0].name).toBe('openai');
    expect(llm.grades?.core?.model).toBe('gpt-5.4');
    // Extract-on-write: the raw key must NOT be stored in the config document…
    expect(llm.providers?.[0].apiKey).toMatch(/^@SECRETS\//);
    // …but must resolve back to the raw value server-side.
    const resolved = await resolveConfigSecrets(llm.providers![0]);
    expect(resolved.apiKey).toBe('sk-raw-key');
  });

  it('registers without an llm block leaving the config untouched', async () => {
    const mod = new AuthModule();
    await mod.register({
      workspaceName: 'TestCo',
      adminEmail: 'admin@testco.com',
      adminName: 'Admin',
      adminPassword: 'password123',
    });
    const raw = await getRawConfig('org');
    expect('llm' in raw).toBe(false);
  });

  it('creates a provided first connection in org mode', async () => {
    const mod = new AuthModule();
    const result = await mod.register({
      workspaceName: 'TestCo',
      adminEmail: 'admin@testco.com',
      adminName: 'Admin',
      adminPassword: 'password123',
      connection: { name: 'uploads', type: 'csv', config: { files: [] } },
    });
    expect(result.warnings ?? []).toEqual([]);
    const conn = await ConnectionsAPI.getRawByName('uploads', 'org');
    expect(conn.type).toBe('csv');
  });

  it('keeps registration successful when the connection fails, surfacing a warning', async () => {
    const mod = new AuthModule();
    const result = await mod.register({
      workspaceName: 'TestCo',
      adminEmail: 'admin@testco.com',
      adminName: 'Admin',
      adminPassword: 'password123',
      connection: {
        name: 'bad_pg',
        type: 'postgresql',
        config: { host: '127.0.0.1', port: 59999, database: 'x', username: 'x' },
      },
    });
    expect(result.redirectUrl).toBe('/login');
    expect(result.warnings?.length).toBeGreaterThan(0);
    await expect(ConnectionsAPI.getRawByName('bad_pg', 'org')).rejects.toThrow(/not found/i);
  });
});
