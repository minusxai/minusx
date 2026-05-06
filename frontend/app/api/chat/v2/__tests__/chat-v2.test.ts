// Chat-V2 E2E tests — TS-orchestrator-driven /api/chat/v2 lifecycle.
//
// These exercise:
//   1. First-message draft → publish lifecycle (chat file gets the user
//      message as its name; draft=false; content has no `metadata.name`).
//   2. Pause-resume across the UIE bridge: first POST yields a pending
//      EditFile, a second POST with synthetic completedToolCalls drives the
//      orchestrator to a stop turn, and the final log has the full
//      [invocation, tool_call, tool_result, stop] sequence.
//   3. Fork on optimistic-append conflict: two appends with the same
//      expectedLogIndex — the second forks to a new chat file with
//      `forkedFrom: <original>`.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import {
  fauxAssistantMessage,
  fauxToolCall,
  type ToolResultMessage,
} from '@mariozechner/pi-ai';
import { POST as chatV2PostHandler } from '@/app/api/chat/v2/route';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { FilesAPI } from '@/lib/data/files.server';
import {
  appendChatLog,
  loadChatLog,
  type ChatContent,
} from '@/lib/chat-v2/chat-file';
import {
  cleanupTestDatabase,
  getTestDbPath,
  initTestDatabase,
} from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLogEntry } from '@/orchestrator/types';
import { NextRequest } from 'next/server';

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

function createNextRequestV2(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat/v2', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

interface ChatV2Response {
  chatId: number;
  forked: boolean;
  log: ConversationLogEntry[];
  pendingToolCalls: { id: string; name: string; parameters: Record<string, unknown> }[];
  done: 'stop' | 'pending' | 'error';
  error?: string;
}

const dbPath = getTestDbPath('chat_v2_e2e');

beforeAll(async () => {
  await initTestDatabase(dbPath);
});

afterAll(async () => {
  await cleanupTestDatabase(dbPath);
});

describe('Chat V2 — Test 1: send-message lifecycle', () => {
  it('creates a draft chat, runs the agent, publishes with first-message name and no metadata.name in content', async () => {
    webAnalystFaux.setResponses([
      fauxAssistantMessage('Sure, here is what you asked.', { stopReason: 'stop' }),
    ]);

    const userMessage = 'What is the latest revenue';
    const response = await chatV2PostHandler(createNextRequestV2({ message: userMessage }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as ChatV2Response;

    expect(body.error).toBeUndefined();
    expect(body.done).toBe('stop');
    expect(body.pendingToolCalls).toEqual([]);
    expect(body.chatId).toBeGreaterThan(0);
    expect(body.forked).toBe(false);

    // The orchestrator log should contain: root AgentInvocation, assistant stop turn.
    expect(body.log.length).toBeGreaterThanOrEqual(2);
    const rootEntry = body.log[0] as { type?: string; parent_id?: string | null };
    expect(rootEntry.type).toBe('toolCall');
    expect(rootEntry.parent_id).toBeNull();

    // DB-side: file is published, named after the user message, has no metadata.name.
    const file = await FilesAPI.loadFile(body.chatId, ADMIN);
    expect(file.data.draft).toBe(false);
    expect(file.data.name).toBe(userMessage);
    expect(file.data.path).toContain('/chats/');
    const content = file.data.content as unknown as ChatContent;
    expect(content.agent).toBe('WebAnalystAgent');
    expect(content.log.length).toBeGreaterThanOrEqual(2);
    expect((content as unknown as { metadata?: { name?: string } }).metadata?.name).toBeUndefined();
  });
});

describe('Chat V2 — Test 2: pause-resume across UIE bridge', () => {
  it('pauses on EditFile, resumes via completedToolCalls, finishes on stop', async () => {
    const editCallId = 'call_edit_t2';

    webAnalystFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', { fileId: 99, changes: [{ oldMatch: 'foo', newMatch: 'bar' }] }, { id: editCallId })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Edit applied.', { stopReason: 'stop' }),
    ]);

    // Turn 1: POST with new message → pending EditFile.
    const r1 = await chatV2PostHandler(createNextRequestV2({ message: 'rename foo to bar in file 99' }));
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as ChatV2Response;
    expect(b1.error).toBeUndefined();
    expect(b1.done).toBe('pending');
    expect(b1.pendingToolCalls).toHaveLength(1);
    expect(b1.pendingToolCalls[0].name).toBe('EditFile');
    expect(b1.pendingToolCalls[0].id).toBe(editCallId);

    const chatId = b1.chatId;

    // Synthesize the bridge result — this is what `bridgePendingTools` would
    // return after invoking the frontend EditFile handler against real Redux.
    const trm: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: editCallId,
      toolName: 'EditFile',
      content: [{ type: 'text', text: 'Edit applied successfully.' }],
      isError: false,
      timestamp: Date.now(),
    };

    // Turn 2: POST with completedToolCalls → orchestrator resumes.
    const r2 = await chatV2PostHandler(
      createNextRequestV2({ chatId, completedToolCalls: [trm] }),
    );
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as ChatV2Response;
    expect(b2.error).toBeUndefined();
    expect(b2.done).toBe('stop');
    expect(b2.pendingToolCalls).toEqual([]);
    expect(b2.chatId).toBe(chatId);

    // Final log shape: root invocation → assistant tool_call → tool_result → assistant stop.
    const log = b2.log;
    const tool_call_entry = log.find(
      (e) =>
        'role' in e && e.role === 'assistant' &&
        e.content.some((c) => c.type === 'toolCall' && c.id === editCallId),
    );
    expect(tool_call_entry).toBeDefined();
    const tool_result_entry = log.find(
      (e) =>
        'role' in e && e.role === 'toolResult' && e.toolCallId === editCallId,
    );
    expect(tool_result_entry).toBeDefined();
    const stop_entry = log.find(
      (e) =>
        'role' in e && e.role === 'assistant' &&
        (e as { stopReason?: string }).stopReason === 'stop',
    );
    expect(stop_entry).toBeDefined();
  });
});

describe('Chat V2 — Test 3: fork on log-index mismatch', () => {
  it('appendChatLog forks to a new chat file when expectedLogIndex is stale', async () => {
    // Establish a chat with N=1 entry. Pretend the server has already
    // appended one entry; subsequent appends with expectedLogIndex=0 must fork.
    const initialEntries: ConversationLogEntry[] = [
      {
        type: 'toolCall',
        id: 'root_t3',
        name: 'WebAnalystAgent',
        arguments: { userMessage: 'first' },
        context: { userId: '1', mode: 'org' },
        parent_id: null,
      } as ConversationLogEntry,
    ];

    // Bootstrap: create a draft chat and atomically append the first entry.
    const drafted = await FilesAPI.createFile(
      {
        name: 'New Chat',
        path: '/org/chats/test3-bootstrap.chat.json',
        type: 'chat',
        content: { log: [], agent: 'WebAnalystAgent', agent_args: {}, metadata: { updatedAt: new Date().toISOString() } },
        options: { createPath: true, returnExisting: false },
      },
      ADMIN,
    );
    const chatId = drafted.data.id;
    const r0 = await appendChatLog(chatId, initialEntries, 0, ADMIN);
    expect(r0.forked).toBe(false);
    expect(r0.chatId).toBe(chatId);

    const second: ConversationLogEntry[] = [
      {
        type: 'toolCall',
        id: 'root_t3_concurrent',
        name: 'WebAnalystAgent',
        arguments: { userMessage: 'second (stale)' },
        context: { userId: '1', mode: 'org' },
        parent_id: null,
      } as ConversationLogEntry,
    ];
    // Stale expectedLogIndex (0 — but actual length is 1) → fork.
    const r1 = await appendChatLog(chatId, second, 0, ADMIN);
    expect(r1.forked).toBe(true);
    expect(r1.chatId).not.toBe(chatId);

    // Forked content should have the prefix (zero entries from .slice(0,0))
    // plus the new diff. Forked file metadata should reference the original.
    const forkedContent = await loadChatLog(r1.chatId, ADMIN);
    expect(forkedContent.forkedFrom).toBe(chatId);
    expect(forkedContent.log).toHaveLength(1);
    expect((forkedContent.log[0] as { id: string }).id).toBe('root_t3_concurrent');
  });
});
