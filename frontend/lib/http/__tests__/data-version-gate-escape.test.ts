/**
 * The route that clears a failing version gate must not be behind it.
 *
 * Migrations do not run at boot, so the gate's refusal is escaped by calling
 * POST /api/admin/migrate-db. Wrapping that route in the ordinary `withAuth` makes the
 * refusal unescapable: every request 503s, including the one fix, and the UI's Migrate
 * button reports the gate's own message back at the user forever.
 *
 * That is exactly what shipped until a browser found it — both halves were individually
 * correct, and nothing tested them together. This pins the pairing.
 */
import { withAuth, withAuthSkippingDataVersionGate } from '@/lib/http/with-auth';
import { checkDataVersion } from '@/lib/database/data-version-gate';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/database/data-version-gate', async (orig) => ({
  ...(await orig<typeof import('@/lib/database/data-version-gate')>()),
  checkDataVersion: vi.fn(),
}));

vi.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: vi.fn().mockResolvedValue({
    email: 'admin@example.com', role: 'admin', mode: 'org', userId: 1, home_folder: '/org',
  }),
}));

const req = { nextUrl: { pathname: '/api/admin/migrate-db' } } as unknown as NextRequest;
const ok = () => NextResponse.json({ handled: true });

beforeEach(() => {
  vi.mocked(checkDataVersion).mockClear();
  // The state the escape hatch exists for: data older than this build can read.
  vi.mocked(checkDataVersion).mockResolvedValue({
    ok: false, version: 30, reason: 'upgrade-pending',
  });
});

describe('data-version gate escape', () => {
  it('lets the exempt wrapper through while the gate is refusing', async () => {
    const res = await withAuthSkippingDataVersionGate(async () => ok())(req);
    expect(res.status).toBe(200);
  });

  it('still refuses an ordinary route in the same state', async () => {
    // The counterpart — if this ever passes, the gate has stopped gating anything.
    const res = await withAuth(async () => ok())(req);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'upgrade-pending' });
  });

  it('refuses the exempt wrapper when there is no user at all', async () => {
    // Skipping the VERSION gate must not skip authentication: this route rewrites every
    // file and user in the workspace.
    const { getEffectiveUser } = await import('@/lib/auth/auth-helpers');
    vi.mocked(getEffectiveUser).mockResolvedValueOnce(null);

    const res = await withAuthSkippingDataVersionGate(async () => ok())(req);
    expect(res.status).toBe(401);
  });

  it('does not consult the gate at all when exempt', async () => {
    // Not merely ignoring the verdict — a workspace mid-migration should not have the
    // check run against it on the way in.
    await withAuthSkippingDataVersionGate(async () => ok())(req);
    expect(checkDataVersion).not.toHaveBeenCalled();
  });
});
