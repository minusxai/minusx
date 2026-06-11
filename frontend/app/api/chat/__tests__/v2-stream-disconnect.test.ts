// Mid-stream client disconnect — reproduction + resume protocol.
//
// Reproduces the prod failure mode: a user's connection to /api/chat/stream is
// severed mid-turn (app restart, corporate middlebox, network blip). Asserts the
// DESIRED behavior:
//   1. The turn still completes server-side and the FULL log is persisted to the
//      conversation file (today the generator's persist-once fires at disconnect
//      time, snapshotting a partial log and dropping the completed tail).
//   2. A resume request (same endpoint, `resume.afterSeq`) replays the missed
//      frames and the done event, so the client can reconnect seamlessly.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { POST as chatStreamPostHandler } from '@/app/api/chat/stream/route';
import { __clearAllRuns } from '@/lib/chat/run-registry.server';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('v2_stream_disconnect');

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

vi.mock('@/lib/auth/auth-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/auth-helpers')>('@/lib/auth/auth-helpers');
  return {
    ...actual,
    getEffectiveUser: vi.fn(async () => ADMIN),
  };
});

// ─── helpers ─────────────────────────────────────────────────────────

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function seedConversation(name: string): Promise<number> {
  const created = await FilesAPI.createFile(
    {
      name,
      path: `/org/logs/conversations/1/${name}.chat.json`,
      type: 'conversation',
      content: {
        metadata: { userId: '1', name, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', logLength: 0 },
        log: [],
      } as never,
      meta: { version: 2 },
      options: { createPath: true, returnExisting: false },
    },
    ADMIN,
  );
  return created.data.id;
}

function streamRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat/stream', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

interface SSEFrame { event: string; data: any }

/** Read SSE frames from a response reader until it ends or `until` returns true. */
async function readFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  until?: (f: SSEFrame) => boolean,
): Promise<SSEFrame[]> {
  const decoder = new TextDecoder();
  const frames: SSEFrame[] = [];
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const eventMatch = chunk.match(/^event: (.+)$/m);
      const dataMatch = chunk.match(/^data: (.+)$/m);
      if (!eventMatch || !dataMatch) continue; // ping comments
      const frame = { event: eventMatch[1], data: JSON.parse(dataMatch[1]) };
      frames.push(frame);
      if (until?.(frame)) return frames;
    }
  }
  return frames;
}

async function loadConversationLogText(conversationId: number): Promise<string> {
  const result = await FilesAPI.loadFiles([conversationId], ADMIN);
  const file = result.data.find((f: { id: number }) => f.id === conversationId);
  return JSON.stringify((file as { content?: { log?: unknown[] } })?.content?.log ?? []);
}

/** Poll the conversation file until its log contains `needle` (or timeout). */
async function waitForPersisted(conversationId: number, needle: string, timeoutMs = 5000): Promise<string> {
  const t0 = Date.now();
  let logText = '';
  while (Date.now() - t0 < timeoutMs) {
    logText = await loadConversationLogText(conversationId);
    if (logText.includes(needle)) return logText;
    await new Promise((r) => setTimeout(r, 100));
  }
  return logText;
}

// ─── tests ───────────────────────────────────────────────────────────

describe('mid-stream disconnect: persistence + resume', () => {
  setupTestDb(TEST_DB_PATH);

  // setupTestDb resets the DB per test, so conversation ids REPEAT across tests.
  // The run registry is per-process state keyed by conversation id — clear it so
  // a test can't attach to a previous test's run under a reused id.
  beforeEach(() => __clearAllRuns());

  it('persists the COMPLETE turn even when the client disconnects mid-run', async () => {
    const conversationId = await seedConversation('disconnect-persist');

    // Gate the faux LLM on a deferred so the turn is provably in flight when
    // the client disconnects.
    const gate = deferred();
    webAnalystFaux.setResponses([
      async () => {
        await gate.promise;
        return fauxAssistantMessage('The answer is 42.', { stopReason: 'stop' });
      },
    ]);

    const res = await chatStreamPostHandler(
      streamRequest({ conversationID: conversationId, user_message: 'What is the answer?' }),
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();

    // Receive the initial bytes (ping flush), then sever the connection while
    // the engine is still blocked on the gate — the prod disconnect scenario.
    await reader.read();
    await reader.cancel();

    // Engine finishes AFTER the disconnect.
    gate.resolve();

    // Desired: the completed turn is persisted to the conversation file.
    const logText = await waitForPersisted(conversationId, 'The answer is 42.');
    expect(logText).toContain('The answer is 42.');
  }, 15000);

  it('a resume request replays missed frames and the done event', async () => {
    const conversationId = await seedConversation('disconnect-resume');

    const gate = deferred();
    webAnalystFaux.setResponses([
      async () => {
        await gate.promise;
        return fauxAssistantMessage('Resumed answer: 99.', { stopReason: 'stop' });
      },
    ]);

    const res = await chatStreamPostHandler(
      streamRequest({ conversationID: conversationId, user_message: 'Resume me' }),
    );
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel(); // disconnect before any streaming_event arrived

    gate.resolve();
    await waitForPersisted(conversationId, 'Resumed answer: 99.');

    // Reconnect: ask for everything after seq 0.
    const resumeRes = await chatStreamPostHandler(
      streamRequest({ conversationID: conversationId, resume: { afterSeq: 0 } }),
    );
    expect(resumeRes.status).toBe(200);
    const frames = await readFrames(resumeRes.body!.getReader(), (f) => f.event === 'done');

    // The missed turn arrives on the resumed connection, ending with done.
    const doneFrame = frames.find((f) => f.event === 'done');
    expect(doneFrame).toBeDefined();
    expect(doneFrame!.data.error ?? undefined).toBeUndefined();
    const allText = JSON.stringify(frames);
    expect(allText).toContain('Resumed answer: 99.');

    // Frames carry monotonically increasing sequence numbers for resume tracking.
    const seqs = frames.map((f) => f.data.seq).filter((s) => typeof s === 'number');
    expect(seqs.length).toBeGreaterThan(0);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  }, 15000);

  it('resume for an unknown run signals a miss instead of hanging', async () => {
    const conversationId = await seedConversation('disconnect-miss');

    const resumeRes = await chatStreamPostHandler(
      streamRequest({ conversationID: conversationId, resume: { afterSeq: 0 } }),
    );
    expect(resumeRes.status).toBe(200);
    const frames = await readFrames(resumeRes.body!.getReader(), (f) => f.event === 'done');
    const doneFrame = frames.find((f) => f.event === 'done');
    expect(doneFrame).toBeDefined();
    expect(doneFrame!.data.resume_miss).toBe(true);
  }, 15000);
});
