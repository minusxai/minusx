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

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

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
});
