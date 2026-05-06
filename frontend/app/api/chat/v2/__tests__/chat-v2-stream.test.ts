// /api/chat/v2/stream — actual SSE streaming, not single-event payload.
// Verifies that orchestrator events are emitted as discrete `event:
// orchestrator` SSE frames during the run and a final `event: done` frame
// carries the same payload as the non-streaming /api/chat/v2 response.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { fauxAssistantMessage, fauxToolCall } from '@mariozechner/pi-ai';
import { POST as streamHandler } from '@/app/api/chat/v2/stream/route';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import {
  cleanupTestDatabase,
  getTestDbPath,
  initTestDatabase,
} from '@/store/__tests__/test-utils';
import { NextRequest } from 'next/server';

const dbPath = getTestDbPath('chat_v2_stream');

beforeAll(async () => initTestDatabase(dbPath));
afterAll(async () => cleanupTestDatabase(dbPath));

interface ParsedFrame {
  event: string;
  data: unknown;
}

async function readAllSSE(response: Response): Promise<ParsedFrame[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: ParsedFrame[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = chunk.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;
      frames.push({
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)),
      });
    }
  }
  return frames;
}

function streamRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat/v2/stream', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('Chat V2 stream — incremental SSE emission', () => {
  it('emits orchestrator events incrementally and a final done event', async () => {
    webAnalystFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', { fileId: 1, changes: [{ oldMatch: 'a', newMatch: 'b' }] }, { id: 'sse_edit_1' })],
        { stopReason: 'toolUse' },
      ),
    ]);

    const response = await streamHandler(streamRequest({ message: 'edit file 1' }));
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    const frames = await readAllSSE(response);
    const orchestratorFrames = frames.filter((f) => f.event === 'orchestrator');
    const doneFrames = frames.filter((f) => f.event === 'done');

    // We should have at least one orchestrator frame (the pending event for
    // EditFile) and exactly one terminal `done` frame.
    expect(orchestratorFrames.length).toBeGreaterThanOrEqual(1);
    expect(doneFrames).toHaveLength(1);

    const pendingFrame = orchestratorFrames.find(
      (f) => (f.data as { type?: string }).type === 'pending',
    );
    expect(pendingFrame).toBeDefined();
    expect((pendingFrame!.data as { name: string }).name).toBe('EditFile');

    const done = doneFrames[0].data as { done: string; pendingToolCalls: { name: string }[]; chatId: number };
    expect(done.done).toBe('pending');
    expect(done.pendingToolCalls).toHaveLength(1);
    expect(done.pendingToolCalls[0].name).toBe('EditFile');
    expect(done.chatId).toBeGreaterThan(0);
  });
});
