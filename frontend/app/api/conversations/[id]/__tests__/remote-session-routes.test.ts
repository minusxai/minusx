// Remote Agent Sessions — mint/stop/status routes, the public /s/<code> skill doc, mutual-exclusion
// guards, fork stripping, and lazy expiry release. Runs against the real route handlers + test DB.

import { NextRequest } from 'next/server';
import {
  POST as mintRoute,
  DELETE as stopRoute,
  GET as statusRoute,
} from '@/app/api/conversations/[id]/remote-session/route';
import { GET as skillDocRoute } from '@/app/s/[code]/route';
import {
  createConversation,
  getConversation,
  setRunStatus,
  loadMessages,
  forkConversation,
} from '@/lib/data/conversations.server';
import { decodeRemoteSessionCode, saveRemoteSession } from '@/lib/data/remote-sessions.server';
import type { RemoteSessionMintResult } from '@/lib/data/remote-sessions.types';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('remote_session_routes');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;
const codeCtx = (code: string) => ({ params: Promise.resolve({ code }) }) as never;

async function mint(conversationId: number): Promise<{ status: number; result?: RemoteSessionMintResult }> {
  const res = await mintRoute(
    new NextRequest(`http://localhost:3000/api/conversations/${conversationId}/remote-session`, { method: 'POST' }),
    idCtx(conversationId),
  );
  if (res.status !== 200) return { status: res.status };
  const body = await res.json();
  return { status: res.status, result: body.data as RemoteSessionMintResult };
}

describe('remote session mint / stop / status routes', () => {
  setupTestDb(TEST_DB_PATH);

  it('mint on an idle conversation → remote status, hashed record, root invocation appended', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const { status, result } = await mint(conv.id);
    expect(status).toBe(200);
    expect(result!.url).toContain(`/s/`);
    expect(result!.copyText).toContain(result!.url);
    const decoded = decodeRemoteSessionCode(result!.code);
    expect(decoded?.conversationId).toBe(conv.id);

    const fresh = (await getConversation(conv.id))!;
    expect(fresh.runStatus).toBe('remote');
    expect(fresh.meta.remoteSession?.nonceHash).toMatch(/^[0-9a-f]{64}$/);
    // The nonce itself must never be persisted.
    expect(JSON.stringify(fresh.meta)).not.toContain(decoded!.nonce);

    // Root invocation appended at seq 0: a RemoteSessionAgent AgentInvocation.
    const rows = await loadMessages(conv.id);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('toolCall');
    expect((rows[0].content as { name?: string }).name).toBe('RemoteSessionAgent');
    expect((rows[0].content as { parent_id?: string | null }).parent_id).toBeNull();
  });

  it('mint is refused while a turn is running or paused (mutual exclusion)', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await setRunStatus(conv.id, 'running');
    expect((await mint(conv.id)).status).toBe(409);
    await setRunStatus(conv.id, 'paused');
    expect((await mint(conv.id)).status).toBe(409);
    await setRunStatus(conv.id, 'idle');
    expect((await mint(conv.id)).status).toBe(200);
  });

  it('re-mint revokes the prior code (old link dies, new one works)', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const first = (await mint(conv.id)).result!;
    const second = (await mint(conv.id)).result!;
    expect(second.code).not.toBe(first.code);

    // A replaced code no longer matches the stored hash — indistinguishable from a guess, so it
    // gets the uniform 404 (410 "ended" is only for codes that still prove they owned the session).
    const oldDoc = await skillDocRoute(new NextRequest(`http://localhost:3000/s/${first.code}`), codeCtx(first.code));
    expect(oldDoc.status).toBe(404);
    const newDoc = await skillDocRoute(new NextRequest(`http://localhost:3000/s/${second.code}`), codeCtx(second.code));
    expect(newDoc.status).toBe(200);

    // Re-mint does not append a second root invocation (still one session turn).
    const rows = await loadMessages(conv.id);
    expect(rows.filter((r) => r.kind === 'toolCall').length).toBe(1);
  });

  it('DELETE stops the session: revoked + released to idle', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const { result } = await mint(conv.id);
    const res = await stopRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conv.id}/remote-session`, { method: 'DELETE' }),
      idCtx(conv.id),
    );
    expect(res.status).toBe(200);
    const fresh = (await getConversation(conv.id))!;
    expect(fresh.runStatus).toBe('idle');
    expect(fresh.meta.remoteSession?.revoked).toBe(true);

    const doc = await skillDocRoute(new NextRequest(`http://localhost:3000/s/${result!.code}`), codeCtx(result!.code));
    expect(doc.status).toBe(410);
  });

  it('GET reports active status for the UI banner', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    let res = await statusRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conv.id}/remote-session`),
      idCtx(conv.id),
    );
    expect((await res.json()).data.active).toBe(false);

    await mint(conv.id);
    res = await statusRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conv.id}/remote-session`),
      idCtx(conv.id),
    );
    const body = (await res.json()).data;
    expect(body.active).toBe(true);
    expect(typeof body.expiresAt).toBe('string');
  });

  it('owner-only: another user’s conversation is forbidden', async () => {
    const conv = await createConversation({ ownerUserId: 999, mode: 'org', agent: 'WebAnalystAgent' });
    expect((await mint(conv.id)).status).toBe(403);
  });

  it('fork strips meta.remoteSession (a fork must never inherit the capability hash)', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await mint(conv.id);
    const fork = await forkConversation(conv.id, 1);
    expect(fork.meta.remoteSession).toBeUndefined();
  });
});

describe('mint captures the current app state (the page the user is looking at)', () => {
  setupTestDb(TEST_DB_PATH);

  const APP_STATE = {
    type: 'file',
    state: { fileState: { id: 77, type: 'dashboard', name: 'Executive KPIs', path: '/org/executive-kpis' } },
  };

  async function mintWithAppState(conversationId: number) {
    const res = await mintRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conversationId}/remote-session`, {
        method: 'POST',
        body: JSON.stringify({ appState: APP_STATE }),
      }),
      idCtx(conversationId),
    );
    return (await res.json()).data as RemoteSessionMintResult;
  }

  it('the session root invocation carries the app state (tools + later turns see the page)', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await mintWithAppState(conv.id);
    const rows = await loadMessages(conv.id);
    const ctx = (rows[0].content as { context?: { appState?: { type?: string }; pageType?: string } }).context;
    expect(ctx?.appState?.type).toBe('file');
    expect(ctx?.pageType).toBe('dashboard');
  });

  it('the skill doc and /context tell the agent what page the user is on', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const mint = await mintWithAppState(conv.id);
    const doc = await (await skillDocRoute(new NextRequest(`http://localhost:3000/s/${mint.code}`), codeCtx(mint.code))).text();
    expect(doc).toContain('Executive KPIs');
    expect(doc).toContain('77');

    const { GET: contextRoute } = await import('@/app/s/[code]/context/route');
    const snapshot = await (await contextRoute(new NextRequest(`http://localhost:3000/s/${mint.code}/context`), codeCtx(mint.code))).json();
    expect(snapshot.currentPage).toMatchObject({ fileId: 77, fileType: 'dashboard', fileName: 'Executive KPIs' });
  });
});

describe('public /s/<code> skill document', () => {
  setupTestDb(TEST_DB_PATH);

  it('serves the toolset + protocol as markdown for a live session', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const { result } = await mint(conv.id);
    const res = await skillDocRoute(new NextRequest(`http://localhost:3000/s/${result!.code}`), codeCtx(result!.code));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    const doc = await res.text();
    // Protocol + toolset present; ClarifyFrontend deliberately excluded; agents never exposed.
    expect(doc).toContain(`/s/${result!.code}/tool`);
    expect(doc).toContain('ExecuteQuery');
    expect(doc).toContain('EditFile');
    expect(doc).not.toContain('ClarifyFrontend');
    expect(doc).not.toContain('WebAnalystAgent');
  });

  it('unknown / malformed codes → 404', async () => {
    const res = await skillDocRoute(new NextRequest('http://localhost:3000/s/zz-nope'), codeCtx('zz-nope'));
    expect(res.status).toBe(404);
    const res2 = await skillDocRoute(
      new NextRequest('http://localhost:3000/s/1z-abcdefabcdefabcdefabcdef'),
      codeCtx('1z-abcdefabcdefabcdefabcdef'),
    );
    expect(res2.status).toBe(404);
  });

  it('lazy expiry: an expired session serves the ended page and releases the conversation', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const { result } = await mint(conv.id);
    // Force the hard TTL into the past.
    const rec = (await getConversation(conv.id))!.meta.remoteSession!;
    await saveRemoteSession(conv.id, { ...rec, expiresAt: new Date(Date.now() - 1000).toISOString() });

    const res = await skillDocRoute(new NextRequest(`http://localhost:3000/s/${result!.code}`), codeCtx(result!.code));
    expect(res.status).toBe(410);
    expect((await res.text()).toLowerCase()).toContain('ended');
    expect((await getConversation(conv.id))!.runStatus).toBe('idle');
  });
});
