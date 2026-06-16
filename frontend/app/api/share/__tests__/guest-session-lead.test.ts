// Verifies the guest-session mint route publishes a SHARE_LEAD app-event when a
// visitor submits their name/email (lead capture) — and does NOT for anonymous
// (skip_lead) sessions.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { NextRequest } from 'next/server';
import { POST } from '../guest-session/route';
import { addShare, createFile } from '@/lib/data/files.server';
import { appEventRegistry } from '@/lib/app-event-registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('guest_session_lead');

const ADMIN: EffectiveUser = {
  userId: 1, email: 'admin@example.com', name: 'Admin',
  role: 'admin', home_folder: '/org', mode: 'org',
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/share/guest-session', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// setupTestDb reseeds the template per-test (beforeEach), so the story + share
// must be created inside each test.
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

describe('POST /api/share/guest-session — SHARE_LEAD event', () => {
  setupTestDb(TEST_DB_PATH);

  let publishSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    publishSpy = vi.spyOn(appEventRegistry, 'publish').mockImplementation(() => {});
  });
  afterEach(() => publishSpy.mockRestore());

  const leadCalls = () => publishSpy.mock.calls.filter((c: unknown[]) => c[0] === 'share:lead');

  it('publishes share:lead with the captured name + email on lead submit', async () => {
    const { shareId, storyId } = await setupShare();
    const res = await POST(makeRequest({ shareId, name: 'Jane Doe', email: 'jane@acme.test' }));
    expect(res.status).toBe(200);

    expect(leadCalls()).toHaveLength(1);
    expect(leadCalls()[0][1]).toMatchObject({
      fileId: storyId,
      name: 'Jane Doe',
      email: 'jane@acme.test',
      userEmail: 'jane@acme.test',  // mirrors email for downstream attribution
      storyName: 'Acme Demo Story',
      mode: 'org',
    });
  });

  it('does NOT publish share:lead for an anonymous (skip_lead) session', async () => {
    const { shareId } = await setupShare();
    const res = await POST(makeRequest({ shareId, skipLead: true }));
    expect(res.status).toBe(200);
    expect(leadCalls()).toHaveLength(0);
  });

  it('does NOT publish share:lead when only a name (no email) is given', async () => {
    const { shareId } = await setupShare();
    const res = await POST(makeRequest({ shareId, name: 'Jane' }));
    expect(res.status).toBe(200);
    expect(leadCalls()).toHaveLength(0);
  });
});
