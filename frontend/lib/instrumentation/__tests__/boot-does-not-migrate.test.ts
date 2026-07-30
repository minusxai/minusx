/**
 * Boot applies the schema and does NOT migrate data.
 *
 * These used to happen together, and that was the one place the mechanism differed
 * between deployments: a single-workspace install migrated itself at startup, while a
 * deployment serving several could not — there is no request at boot, so no workspace to
 * be in, and every replica would race to rewrite the same rows. The result was one code
 * path that only ever ran in one of them.
 *
 * Now neither migrates at boot. A build refuses data outside the range it can read and an
 * admin triggers POST /api/admin/migrate-db, which runs inside a request and therefore
 * inside whichever workspace asked. Same path everywhere.
 *
 * Asserted at the seam rather than by reading the source, so re-adding the call — or
 * re-adding a `runMigrations` hook for something to implement — turns this red.
 */
import { registerWithModules } from '@/lib/instrumentation/register-modules';
import { getModules } from '@/lib/modules/registry';

const migrateSpy = vi.fn();

vi.mock('@/lib/database/run-migrations', () => ({
  runMigrationsIfNeeded: (...args: unknown[]) => migrateSpy(...args),
  runRowMigration: vi.fn(),
}));

describe('boot', () => {
  beforeEach(() => { migrateSpy.mockClear(); });

  it('never runs data migrations', async () => {
    await registerWithModules();
    expect(migrateSpy).not.toHaveBeenCalled();
  });

  it('does apply the schema', async () => {
    // The counterpart: dropping init() would leave a deployment with no tables at all,
    // so this test must not be read as "boot touches nothing".
    await registerWithModules();
    expect(getModules().db).toBeDefined();
  });

  it('exposes no runMigrations hook for a deployment to implement', async () => {
    // The hook existing at all is what let the two diverge — one stack implemented it,
    // the other did not, and nothing pointed that out.
    await registerWithModules();
    expect((getModules().db as unknown as Record<string, unknown>).runMigrations).toBeUndefined();
  });
});
