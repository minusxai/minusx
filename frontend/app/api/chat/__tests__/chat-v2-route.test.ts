// Merged v=2 chat-route suite (was fork-v1-to-v2, v2-happy-path, init-v2,
// v2-context-selection — all db-config-mock-only, default seed). One shared
// setupTestDb instead of four, and one module-import load.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { POST as chatInitHandler } from '@/app/api/chat/init/route';
import { forkV1ConversationToV2 } from '@/lib/chat-orchestration-v2.server';
import { createNewConversation } from '@/lib/conversations';
import { FilesAPI } from '@/lib/data/files.server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { Mock } from 'vitest';

const TEST_DB_PATH = getTestDbPath('chat_v2_route');

function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('chat v2 route', () => {
  setupTestDb(TEST_DB_PATH);

  describe('forkV1ConversationToV2', () => {
    const USER = { userId: 1, email: 'x@y.z', name: 'X', role: 'admin', home_folder: '/org', mode: 'org' } as unknown as EffectiveUser;

    const LEGACY_LOG = [
      { _type: 'task', _run_id: 'run-r1', agent: 'AnalystAgent', args: { user_message: 'hello' }, unique_id: 'r1', created_at: '2026-01-01T00:00:00.000Z' },
      { _type: 'task', _run_id: 'run-t1', _parent_unique_id: 'r1', agent: 'ExecuteQuery', args: { query: 'SELECT 1' }, unique_id: 't1', created_at: '2026-01-01T00:00:00.000Z' },
      { _type: 'task_result', _task_unique_id: 't1', result: '{"rows":[{"x":1}]}', details: { success: true }, created_at: '2026-01-01T00:00:00.000Z' },
      { _type: 'task', _run_id: 'run-ttu1', _parent_unique_id: 'r1', agent: 'TalkToUser', args: { content_blocks: [{ type: 'text', text: 'hi there' }] }, unique_id: 'ttu1', created_at: '2026-01-01T00:00:00.000Z' },
      { _type: 'task_result', _task_unique_id: 'ttu1', result: '{"success":true,"content_blocks":[{"type":"text","text":"hi there"}]}', created_at: '2026-01-01T00:00:00.000Z' },
    ];

    it('seeds a v2 fork from the v1 log and leaves the original v1 untouched', async () => {
      // A v1 conversation (no meta.version) carrying a legacy log.
      const v1 = await createNewConversation(USER, 'hello', { initialLog: LEGACY_LOG });

      const forkedId = await forkV1ConversationToV2(v1.fileId, USER);
      expect(forkedId).not.toBe(v1.fileId);

      // Fork is a v2 conversation tagged with forkedFrom.
      const forked = await FilesAPI.loadFile(forkedId, USER);
      const meta = forked.data.meta as { version?: number; forkedFrom?: number };
      expect(meta.version).toBe(2);
      expect(meta.forkedFrom).toBe(v1.fileId);

      // Seeded log is the pi shape: root invocation + tool pairing + final answer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const log = (forked.data.content as any).log as any[];
      expect(log[0]).toMatchObject({ type: 'toolCall', id: 'r1', parent_id: null });
      expect(log[0].arguments.userMessage).toBe('hello');
      expect(log.some((e) => e.role === 'toolResult' && e.toolCallId === 't1')).toBe(true);
      const finalAsst = log.find((e) => e.role === 'assistant' && e.stopReason === 'stop');
      expect(finalAsst.content.find((c: { type: string }) => c.type === 'text').text).toBe('hi there');

      // Original v1 is untouched: still v1, still its legacy log.
      const original = await FilesAPI.loadFile(v1.fileId, USER);
      expect((original.data.meta as { version?: number } | null)?.version).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((original.data.content as any).log).toHaveLength(LEGACY_LOG.length);
    });
  });

  describe('POST /api/chat?v=2 — happy path (orchestrator runs, response is legacy shape)', () => {
    const ADMIN: EffectiveUser = {
      userId: 1,
      email: 'test@example.com',
      name: 'Test User',
      role: 'admin',
      home_folder: '/org',
      mode: 'org',
    };

    interface LegacyChatResponse {
      conversationID: number;
      log_index: number;
      pending_tool_calls: Array<{ id: string; type: string; function: { name: string; arguments: Record<string, unknown> } }>;
      completed_tool_calls: Array<{
        role: 'tool';
        tool_call_id: string;
        content: string;
        function: { name: string; arguments: Record<string, unknown> };
      }>;
      debug: Array<{ role: 'debug'; llmDebug: Array<{ total_tokens: number }> }>;
      error?: string;
    }

    it('first turn: creates v=2 conversation, runs orchestrator, returns legacy ChatResponse, renames file, persists orchestrator log', async () => {
      webAnalystFaux.setResponses([
        fauxAssistantMessage('Sure, here is what you asked.', { stopReason: 'stop' }),
      ]);

      const userMessage = 'What is the latest revenue';
      const res = await chatPostHandler(
        makeRequest('http://localhost/api/chat?v=2', { user_message: userMessage }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as LegacyChatResponse;

      expect(body.error).toBeUndefined();
      expect(body.conversationID).toBeGreaterThan(0);

      expect(body.completed_tool_calls.length).toBeGreaterThan(0);
      const ttu = body.completed_tool_calls.find((c) => c.function.name === 'TalkToUser');
      expect(ttu).toBeDefined();
      const parsed = JSON.parse(String(ttu!.content));
      expect(parsed).toMatchObject({
        success: true,
        content_blocks: [{ type: 'text', text: 'Sure, here is what you asked.' }],
      });

      expect(body.pending_tool_calls).toEqual([]);

      expect(body.debug.length).toBeGreaterThan(0);
      expect(body.debug[0].llmDebug[0].total_tokens).toBeGreaterThan(0);

      const file = await FilesAPI.loadFile(body.conversationID, ADMIN);
      const meta = (file.data as { meta?: Record<string, unknown> }).meta;
      expect(meta?.version).toBe(2);
      expect(file.data.type).toBe('conversation');

      const content = file.data.content as unknown as { log: Array<{ type?: string; role?: string; parent_id?: string | null }> };
      expect(content.log.length).toBeGreaterThanOrEqual(2);
      const root = content.log[0];
      expect(root.type).toBe('toolCall');
      expect(root.parent_id).toBeNull();
      const assistant = content.log[1];
      expect(assistant.role).toBe('assistant');

      const metadata = (file.data.content as unknown as { metadata?: { name?: string } }).metadata;
      expect(metadata?.name).toBe(userMessage);
    });

    it('forks ?v=2 against an existing v=1 conversation and continues in v=2 (original preserved)', async () => {
      const created = await FilesAPI.createFile(
        {
          name: 'legacy',
          path: '/org/logs/conversations/1/legacy.chat.json',
          type: 'conversation',
          content: {
            metadata: { userId: '1', name: 'legacy', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', logLength: 3 },
            log: [
              { _type: 'task', _run_id: 'run-r1', agent: 'AnalystAgent', args: { user_message: 'earlier q' }, unique_id: 'r1', created_at: '2025-01-01T00:00:00Z' },
              { _type: 'task', _run_id: 'run-ttu1', _parent_unique_id: 'r1', agent: 'TalkToUser', args: { content_blocks: [{ type: 'text', text: 'earlier a' }] }, unique_id: 'ttu1', created_at: '2025-01-01T00:00:00Z' },
              { _type: 'task_result', _task_unique_id: 'ttu1', result: '{"success":true,"content_blocks":[{"type":"text","text":"earlier a"}]}', created_at: '2025-01-01T00:00:00Z' },
            ],
          } as never,
          options: { createPath: true, returnExisting: false },
        },
        ADMIN,
      );

      webAnalystFaux.setResponses([fauxAssistantMessage('continuing the old chat.', { stopReason: 'stop' })]);

      const res = await chatPostHandler(
        makeRequest('http://localhost/api/chat?v=2', {
          conversationID: created.data.id,
          user_message: 'continue',
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.conversationID).not.toBe(created.data.id);

      const forked = await FilesAPI.loadFile(body.conversationID as number, ADMIN);
      const forkedMeta = forked.data.meta as { version?: number; forkedFrom?: number };
      expect(forkedMeta.version).toBe(2);
      expect(forkedMeta.forkedFrom).toBe(created.data.id);

      const original = await FilesAPI.loadFile(created.data.id, ADMIN);
      expect((original.data.meta as { version?: number } | null)?.version).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((original.data.content as any).log).toHaveLength(3);
    });
  });

  describe('POST /api/chat/init', () => {
    async function getFileMeta(id: number): Promise<{ version?: number } | null> {
      const { getModules } = await import('@/lib/modules/registry');
      const db = getModules().db;
      const { rows } = await db.exec<{ meta: unknown }>(
        'SELECT meta FROM files WHERE id = $1',
        [id],
      );
      if (rows.length === 0) return null;
      return rows[0].meta as { version?: number } | null;
    }

    it('?v=1 → meta.version is NOT set (legacy conversation)', async () => {
      const res = await chatInitHandler(makeRequest('http://localhost/api/chat/init?v=1', { firstMessage: 'hi' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.conversationID).toBeGreaterThan(0);
      const meta = await getFileMeta(body.conversationID);
      expect(meta?.version).toBeUndefined();
    });

    it('default URL → meta.version === 2 (v2 is the default)', async () => {
      const res = await chatInitHandler(makeRequest('http://localhost/api/chat/init', { firstMessage: 'hi default' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.conversationID).toBeGreaterThan(0);
      const meta = await getFileMeta(body.conversationID);
      expect(meta?.version).toBe(2);
    });

    it('?v=2 → meta.version === 2', async () => {
      const res = await chatInitHandler(makeRequest('http://localhost/api/chat/init?v=2', { firstMessage: 'hi v=2' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.conversationID).toBeGreaterThan(0);
      const meta = await getFileMeta(body.conversationID);
      expect(meta?.version).toBe(2);
    });

    it('?v=2 file is type=conversation (NOT type=chat)', async () => {
      const res = await chatInitHandler(makeRequest('http://localhost/api/chat/init?v=2', { firstMessage: 'hi' }));
      const body = await res.json();
      const { getModules } = await import('@/lib/modules/registry');
      const db = getModules().db;
      const { rows } = await db.exec<{ type: string }>(
        'SELECT type FROM files WHERE id = $1',
        [body.conversationID],
      );
      expect(rows[0].type).toBe('conversation');
    });
  });

  describe('POST /api/chat?v=2 — honors client-resolved agent_args (context, connection, viz types)', () => {
    async function captureSystemPrompt(agentArgs: Record<string, unknown>): Promise<string> {
      let captured = '';
      webAnalystFaux.setResponses([
        (context) => {
          captured = context.systemPrompt ?? '';
          return fauxAssistantMessage('ok', { stopReason: 'stop' });
        },
      ]);
      const res = await chatPostHandler(
        makeRequest('http://localhost/api/chat?v=2', { user_message: 'hi', agent_args: agentArgs }),
      );
      expect(res.status).toBe(200);
      return captured;
    }

    async function captureUserMessage(
      agentArgs: Record<string, unknown>,
      userMessage = 'how many users?',
    ): Promise<Array<{ type: string; text?: string; data?: string; mimeType?: string }>> {
      let blocks: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
      webAnalystFaux.setResponses([
        (context) => {
          const msgs = (context as { messages?: Array<{ role: string; content: unknown }> }).messages ?? [];
          const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
          blocks = (lastUser?.content as typeof blocks) ?? [];
          return fauxAssistantMessage('ok', { stopReason: 'stop' });
        },
      ]);
      const res = await chatPostHandler(
        makeRequest('http://localhost/api/chat?v=2', { user_message: userMessage, agent_args: agentArgs }),
      );
      expect(res.status).toBe(200);
      return blocks;
    }

    it("injects the client-resolved agent_args.context into the agent's system prompt", async () => {
      const MARKER = 'SELECTED_CONTEXT_MARKER_7f3a';
      const prompt = await captureSystemPrompt({ context: `# Knowledge Base\n${MARKER}` });
      expect(prompt).toContain(MARKER);
    });

    it('injects the client-resolved agent_args.connection_id (not the server-re-resolved one)', async () => {
      const CONN = 'client_conn_marker_9z';
      const prompt = await captureSystemPrompt({ connection_id: CONN });
      expect(prompt).toContain(CONN);
    });

    it('injects the client-resolved agent_args.allowed_viz_types into the system prompt', async () => {
      const VIZ = 'zigzag_marker_viz';
      const prompt = await captureSystemPrompt({ allowed_viz_types: [VIZ] });
      expect(prompt).toContain(VIZ);
    });

    it('injects agent_args.schema (whitelisted tables) into the system prompt', async () => {
      const prompt = await captureSystemPrompt({ schema: [{ schema: 's', tables: ['SchemaMarkerTbl_q1'] }] });
      expect(prompt).toContain('SchemaMarkerTbl_q1');
    });

    it("injects the effective user's home_folder and role into the system prompt", async () => {
      (getEffectiveUser as unknown as Mock).mockResolvedValueOnce({
        userId: 1,
        email: 'x@y.z',
        name: 'X',
        role: 'editor',
        home_folder: '/org/HomeMarkerXYZ',
        mode: 'org',
      });
      const prompt = await captureSystemPrompt({});
      expect(prompt).toContain('HomeMarkerXYZ'); // resolved home folder
      expect(prompt).toContain('User Role: editor'); // role slot
    });

    it('uses the client-resolved agent_args.agent_name as the agent identity', async () => {
      const prompt = await captureSystemPrompt({ agent_name: 'BrandMarkerZed' });
      expect(prompt).toContain('You are BrandMarkerZed');
    });

    it('tells the agent max_steps = 30', async () => {
      const prompt = await captureSystemPrompt({});
      expect(prompt).toContain('maximum of 30 tool calls');
    });

    it('preloads the page-relevant skill derived from agent_args.app_state', async () => {
      const prompt = await captureSystemPrompt({
        app_state: { type: 'file', state: { fileState: { type: 'dashboard' } } },
      });
      expect(prompt).toContain('## Instructions: Dashboards');
    });

    it('preloads selected system skills from agent_args.skills.selected', async () => {
      const prompt = await captureSystemPrompt({
        app_state: { type: 'explore' },
        skills: { selected: [{ type: 'system', name: 'alerts' }], user_catalog: [] },
      });
      expect(prompt).toContain('## Instructions: Alerts');
    });

    it('injects selected user skills and uses the unrestricted nav skill', async () => {
      const prompt = await captureSystemPrompt({
        unrestricted_mode: true,
        skills: {
          selected: [{ type: 'user', name: 'kb_skill', content: 'USER_SKILL_BODY_MARKER' }],
          user_catalog: [],
        },
      });
      expect(prompt).toContain('## Instructions: Navigation & Background File Rules (Background Agent Mode)');
      expect(prompt).toContain('USER_SKILL_BODY_MARKER');
    });

    it('lists user-defined skills from agent_args.skills.user_catalog in the LoadSkill catalog', async () => {
      const prompt = await captureSystemPrompt({
        skills: { selected: [], user_catalog: [{ name: 'CompanyKB_marker', description: 'company kb' }] },
      });
      expect(prompt).toContain('CompanyKB_marker');
    });

    it('injects agent_args.app_state into the <AppState> block (not null)', async () => {
      const blocks = await captureUserMessage({
        app_state: { type: 'file', state: { fileState: { id: 7, type: 'dashboard' } } },
      });
      const contextBlock = blocks[0];
      expect(contextBlock.text).toContain('<AppState>{"type":"file"');
      expect(contextBlock.text).not.toContain('<AppState>null</AppState>');
    });

    it('sends the goal as a raw text block (no <Question> wrapper)', async () => {
      const blocks = await captureUserMessage({}, 'COUNT_USERS_GOAL');
      const last = blocks[blocks.length - 1];
      expect(last.type).toBe('text');
      expect(last.text).toBe('COUNT_USERS_GOAL');
    });

    it('threads agent_args.attachments into the user message (image base64 + text block)', async () => {
      const blocks = await captureUserMessage({
        attachments: [
          { type: 'image', name: 'chart.jpg', content: 'data:image/jpeg;base64,Q0hBUlQ=' },
          { type: 'text', name: 'notes.txt', content: 'NOTES_BODY', metadata: { pages: 2 } },
        ],
      });
      const image = blocks.find((b) => b.type === 'image');
      expect(image?.data).toBe('Q0hBUlQ=');
      expect(image?.mimeType).toBe('image/jpeg');
      const contextBlock = blocks[0];
      expect(contextBlock.text).toContain('<Attachment [notes.txt] (2 pages)>\nNOTES_BODY\n</Attachment>');
    });
  });
});
