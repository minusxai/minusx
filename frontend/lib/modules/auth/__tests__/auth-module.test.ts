/**
 * AuthModule E2E tests.
 *
 * Covers workspace registration. The tutorial's sample-data connection ships
 * `dataset` entries that the CSV connector reads from the published source on
 * first use — registration performs no data copying.
 *
 * Run: npm test -- lib/modules/auth/__tests__/auth-module.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_auth_module.db');

import { AuthModule } from '@/lib/modules/auth';
import { truncateAllTables } from '@/store/__tests__/test-utils';
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
  });

  afterEach(async () => {
    cleanupDbFiles();
    vi.clearAllMocks();
  });

  it('seeds the workspace, with the tutorial connection on published dataset entries', async () => {
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

    // The tutorial connection must reference published datasets, not uploaded
    // objects — dataset entries need no copy step and no object-store state.
    const conn = await ConnectionsAPI.getRawByName('static', 'tutorial');
    const files = (conn.config as { files: Array<{ dataset?: string; s3_key?: string }> }).files;
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.dataset === 'mxfood' && f.s3_key === undefined)).toBe(true);
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
