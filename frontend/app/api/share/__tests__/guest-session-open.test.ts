// Verifies the guest-session mint route publishes a SHARE_OPEN app-event the
// first time a NEW visitor opens a share (no existing guest cookie), and does
// NOT re-fire on a reload/return visit (cookie reused).

import { NextRequest } from 'next/server';
import { POST } from '../guest-session/route';
import { addShare, createFile } from '@/lib/data/files.server';
import { appEventRegistry } from '@/lib/app-event-registry';
import { GUEST_COOKIE } from '@/lib/auth/guest-session';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('guest_session_open');

const ADMIN: EffectiveUser = {
  userId: 1, email: 'admin@example.com', name: 'Admin',
  role: 'admin', home_folder: '/org', mode: 'org',
};

function makeRequest(body: unknown, cookie?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/share/guest-session', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  });
}

async function setupShare(): Promise<{ shareId: string; storyId: number }> {
  for (const path of ['/org/demos', '/org/demos/acme']) {
    await createFile({ type: 'folder', name: path.split('/').pop()!, path, content: {} }, ADMIN);
  }
  const story = await createFile(
    { type: 'story', name: 'Acme Demo Story', path: '/org/demos/acme/story',
      content: { description: null, assets: [], story: '<h1>Hi</h1>' } },
    ADMIN,
  );
  const { shareableId } = await addShare(story.data.id, ADMIN);
  return { shareId: shareableId, storyId: story.data.id };
}

describe('POST /api/share/guest-session — SHARE_OPEN event', () => {
  setupTestDb(TEST_DB_PATH);

  let publishSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    publishSpy = vi.spyOn(appEventRegistry, 'publish').mockImplementation(() => {});
  });
  afterEach(() => publishSpy.mockRestore());

  const openCalls = () => publishSpy.mock.calls.filter((c: unknown[]) => c[0] === 'share:open');

  it('publishes share:open the first time a new visitor opens the link', async () => {
    const { shareId, storyId } = await setupShare();
    const res = await POST(makeRequest({ shareId, skipLead: true }));
    expect(res.status).toBe(200);

    expect(openCalls()).toHaveLength(1);
    expect(openCalls()[0][1]).toMatchObject({
      fileId: storyId,
      storyName: 'Acme Demo Story',
      folderPath: '/org/demos/acme',
      anonymous: true,   // skip_lead → no captured lead
      mode: 'org',
    });
  });

  it('does NOT re-fire share:open on a reload (existing cookie for the same share)', async () => {
    const { shareId } = await setupShare();
    const first = await POST(makeRequest({ shareId, skipLead: true }));
    expect(openCalls()).toHaveLength(1);

    // Reload: send back the cookie the first mint set.
    const token = first.cookies.get(GUEST_COOKIE)?.value;
    expect(token).toBeTruthy();
    const second = await POST(makeRequest({ shareId, skipLead: true }, `${GUEST_COOKIE}=${token}`));
    expect(second.status).toBe(200);

    // Still just the one open event — the reload reused the cookie.
    expect(openCalls()).toHaveLength(1);
  });

  it('marks anonymous:false when the first open lands with a lead', async () => {
    const { shareId } = await setupShare();
    await POST(makeRequest({ shareId, name: 'Jane', email: 'jane@acme.test' }));
    expect(openCalls()).toHaveLength(1);
    expect(openCalls()[0][1]).toMatchObject({ anonymous: false, userEmail: 'jane@acme.test' });
  });
});
