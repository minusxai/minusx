/**
 * Slack Bot Integration — E2E Tests
 *
 * Tests the full Slack event → MinusX agent → Slack reply flow.
 * The Slack path now runs the v2 (in-process TypeScript orchestrator) — the
 * No backend is spawned. Only LLM calls are mocked (via the
 * SlackAgent's faux provider); everything else is real (PGLite DB, real
 * orchestration loop, Slack API calls mocked via fetch interceptors).
 *
 * Run: npm test -- lib/integrations/slack/__tests__/slack.e2e.test.ts
 */

// ============================================================================
// DB mock — MUST be declared before any imports (Jest hoisting)
// ============================================================================

import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { POST, processSlackEvent } from '@/app/api/integrations/slack/events/route';
import type { SlackInstallationMatch } from '@/lib/integrations/slack/store';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { fauxRegistration as slackFaux } from '@/agents/slack/slack-agent';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';

const TEST_DB_PATH = getTestDbPath('slack_e2e');

// ── Fixture constants ────────────────────────────────────────────────────────
const TEST_BOT_TOKEN = 'xoxb-test-bot-token';
const TEST_SIGNING_SECRET = 'test-signing-secret-12345678';
const TEST_TEAM_ID = 'T_TEST_TEAM';
const TEST_CHANNEL = 'C_TEST_CHAN';
const TEST_USER_ID = 'U_TEST_USER';
const TEST_UNKNOWN_USER_ID = 'U_UNKNOWN_USER';
const TEST_BOT_USER_ID = 'U_BOT_ID';
const TEST_EMAIL = 'slack-test@example.com';
// Admin user whose stored home_folder is the documented default '/org' — this is
// what reproduces the SearchFiles resolution bug ('/org' → '/org/org' search root).
const TEST_ADMIN_USER_ID = 'U_ADMIN_USER';
const TEST_ADMIN_EMAIL = 'slack-admin@example.com';
const TEST_CONNECTION_NAME = 'test_warehouse';
const TEST_QUESTION_NAME = 'Weekly Revenue Report';

/**
 * v3: the Slack thread conversation log lives in the `messages` table (one row per pi entry),
 * not a conversation file. Returns the most-recently-created Slack conversation's full log as JSON.
 */
async function latestSlackLogJson(): Promise<string> {
  const { getModules } = await import('@/lib/modules/registry');
  const { rows } = await getModules().db.exec<{ content: unknown }>(
    `SELECT m.content FROM messages m
       WHERE m.conversation_id = (SELECT MAX(id) FROM conversations WHERE agent = 'SlackAgent')
       ORDER BY m.seq ASC`,
    [],
  );
  return JSON.stringify(rows.map((r) => r.content));
}

// ============================================================================
// DB fixture setup
// ============================================================================

async function addSlackTestFixtures(_dbPath: string): Promise<void> {
  const { getModules } = await import('@/lib/modules/registry');
  const db = getModules().db;
  const now = new Date().toISOString();

  // /org/configs folder and /org/configs/config already exist (created by initTestDatabase
  // via workspace-template.json). Update the config content with the slack bot configuration.
  const configContent = {
    bots: [{
      type: 'slack',
      name: 'Test Bot',
      install_mode: 'manifest_manual',
      bot_token: TEST_BOT_TOKEN,
      signing_secret: TEST_SIGNING_SECRET,
      team_id: TEST_TEAM_ID,
      team_name: 'Test Workspace',
      bot_user_id: TEST_BOT_USER_ID,
      enabled: true,
    }],
  };
  await db.exec(
    `UPDATE files SET content = $1 WHERE path = $2`,
    [JSON.stringify(configContent), '/org/configs/config']
  );

  // MinusX user whose email matches the Slack user.
  // id=1 is already created by initTestDatabase (template admin), so use id=2.
  await db.exec(
    `INSERT INTO users (id, email, name, password_hash, phone, state, home_folder, role, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [2, TEST_EMAIL, 'Slack Test User', null, null, null, '', 'viewer', now, now]
  );

  // Admin user with the documented default home_folder '/org'. Admins can access
  // every file, so the ONLY thing that can make their SearchFiles return empty is
  // the search-root resolution bug ('/org' → '/org/org'). This mirrors the prod
  // user (id=1 admin) who has lots of files but got empty results.
  await db.exec(
    `INSERT INTO users (id, email, name, password_hash, phone, state, home_folder, role, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [3, TEST_ADMIN_EMAIL, 'Slack Admin User', null, null, null, '/org', 'admin', now, now]
  );

  // Seed a connection so ListDBConnections has something to return, and a question
  // under /org so SearchFiles has something to find.
  const { DocumentDB } = await import('@/lib/database/documents-db');
  await DocumentDB.create(
    TEST_CONNECTION_NAME,
    `/org/database/${TEST_CONNECTION_NAME}`,
    'connection',
    { name: TEST_CONNECTION_NAME, type: 'postgresql', config: { host: 'localhost' }, description: 'Sales warehouse' } as any,
    [],
    undefined,
    false,
  );
  await DocumentDB.create(
    TEST_QUESTION_NAME,
    `/org/${TEST_QUESTION_NAME}`,
    'question',
    { name: TEST_QUESTION_NAME, query: 'SELECT 1', description: 'Tracks weekly revenue', connection_name: TEST_CONNECTION_NAME, vizSettings: { type: 'table' }, parameters: [] } as any,
    [],
    undefined,
    false,
  );
}

// ============================================================================
// Helpers
// ============================================================================

/** Produce a valid X-Slack-Signature for a request body. */
function signSlackRequest(
  rawBody: string,
  signingSecret: string,
  timestamp = Math.floor(Date.now() / 1000),
): { signature: string; timestamp: string } {
  const base = `v0:${timestamp}:${rawBody}`;
  const sig = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  return { signature: sig, timestamp: String(timestamp) };
}

/** Build a Slack app_mention event envelope. */
function makeAppMentionPayload(opts: {
  text?: string;
  userId?: string;
  channel?: string;
  ts?: string;
  threadTs?: string;
  eventId?: string;
  teamId?: string;
}): Record<string, unknown> {
  const ts = opts.ts ?? '1700000000.000001';
  return {
    type: 'event_callback',
    team_id: opts.teamId ?? TEST_TEAM_ID,
    event_id: opts.eventId ?? `Ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    event: {
      type: 'app_mention',
      user: opts.userId ?? TEST_USER_ID,
      text: opts.text ?? `<@${TEST_BOT_USER_ID}> what is the revenue this week?`,
      channel: opts.channel ?? TEST_CHANNEL,
      ts,
      ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
    },
  };
}

/** Build a Slack direct message (message.im) event envelope. */
function makeDMPayload(opts: {
  text?: string;
  userId?: string;
  channel?: string;
  ts?: string;
  threadTs?: string;
  eventId?: string;
  teamId?: string;
}): Record<string, unknown> {
  const ts = opts.ts ?? '1700000000.000001';
  return {
    type: 'event_callback',
    team_id: opts.teamId ?? TEST_TEAM_ID,
    event_id: opts.eventId ?? `Ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    event: {
      type: 'message',
      channel_type: 'im',
      user: opts.userId ?? TEST_USER_ID,
      text: opts.text ?? 'Hello bot',
      channel: opts.channel ?? 'D_TEST_DM',
      ts,
      ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
    },
  };
}

/** Pre-built installation object (bypasses findSlackInstallationByTeam for direct calls). */
function buildInstallation(): SlackInstallationMatch {
  return {
    mode: 'org',
    bot: {
      type: 'slack',
      name: 'Test Bot',
      install_mode: 'manifest_manual',
      bot_token: TEST_BOT_TOKEN,
      signing_secret: TEST_SIGNING_SECRET,
      team_id: TEST_TEAM_ID,
      team_name: 'Test Workspace',
      bot_user_id: TEST_BOT_USER_ID,
      enabled: true,
    },
    config: { bots: [] },
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe('Slack Bot Integration', () => {
  // Records every chat.postMessage call made during a test
  const postedMessages: Array<{ channel: string; text: string; thread_ts?: string }> = [];

  // ── Fetch mock ──────────────────────────────────────────────────────────────
  // No subprocess/LLM-mock ports: the v2 Slack path runs the orchestrator in-process
  // and mocks LLM output via the SlackAgent faux provider (`slackFaux`).
  setupMockFetch({
    additionalInterceptors: [
      async (urlStr: string, init?: RequestInit) => {
        // Slack users.info
        if (urlStr.includes('slack.com/api/users.info')) {
          const qs = new URLSearchParams(urlStr.split('?')[1] ?? '');
          const userId = qs.get('user');
          const email =
            userId === TEST_USER_ID ? TEST_EMAIL
            : userId === TEST_ADMIN_USER_ID ? TEST_ADMIN_EMAIL
            : 'nobody@unknown.example';
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, user: { profile: { email } } }),
          } as Response;
        }
        // Slack chat.postMessage
        if (urlStr.includes('slack.com/api/chat.postMessage')) {
          const body = JSON.parse((init?.body as string | undefined) ?? '{}');
          postedMessages.push({ channel: body.channel, text: body.text, thread_ts: body.thread_ts });
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, ts: `${Date.now()}.000001` }),
          } as Response;
        }
        // Slack reactions.add / reactions.remove
        if (urlStr.includes('slack.com/api/reactions.add') || urlStr.includes('slack.com/api/reactions.remove')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
          } as Response;
        }
        // Slack auth.test (used by manual-install route)
        if (urlStr.includes('slack.com/api/auth.test')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              url: 'https://test-workspace.slack.com/',
              team_id: TEST_TEAM_ID,
              team: 'Test Workspace',
              user: 'test_bot',
              user_id: TEST_BOT_USER_ID,
            }),
          } as Response;
        }
        return null;
      },
    ],
  });

  // ── Test DB setup ───────────────────────────────────────────────────────────
  setupTestDb(TEST_DB_PATH, { customInit: addSlackTestFixtures });

  beforeEach(() => {
    postedMessages.length = 0;
    slackFaux.setResponses([]);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Suite 1 — HTTP route layer (no async work needed, returns before async work)
  // ────────────────────────────────────────────────────────────────────────────

  describe('HTTP route layer', () => {
    it('rejects a request with an invalid signature with 401', async () => {
      const body = JSON.stringify(makeAppMentionPayload({}));
      const req = new NextRequest('http://localhost:3000/api/integrations/slack/events', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'x-slack-signature': 'v0=deadbeef',
          'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('responds to the Slack URL verification challenge', async () => {
      const body = JSON.stringify({ type: 'url_verification', challenge: 'my_challenge_abc' });
      const { signature, timestamp } = signSlackRequest(body, TEST_SIGNING_SECRET);

      const req = new NextRequest('http://localhost:3000/api/integrations/slack/events', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'x-slack-signature': signature,
          'x-slack-request-timestamp': timestamp,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.challenge).toBe('my_challenge_abc');
    });

    it('silently drops bot_id messages to prevent reply loops', async () => {
      const payload = {
        type: 'event_callback',
        team_id: TEST_TEAM_ID,
        event_id: `Ev_bot_${Date.now()}`,
        event: {
          type: 'app_mention',
          bot_id: 'B_SOME_BOT',
          text: 'hello',
          channel: TEST_CHANNEL,
          ts: '1700000001.000001',
        },
      };
      const body = JSON.stringify(payload);
      const { signature, timestamp } = signSlackRequest(body, TEST_SIGNING_SECRET);

      const req = new NextRequest('http://localhost:3000/api/integrations/slack/events', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'x-slack-signature': signature,
          'x-slack-request-timestamp': timestamp,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(postedMessages).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Suite 2 — processSlackEvent (full agent flow with LLM mock)
  // ────────────────────────────────────────────────────────────────────────────

  describe('processSlackEvent', () => {
    it('app_mention: agent replies in the same thread', async () => {
      slackFaux.setResponses([
        fauxAssistantMessage('Revenue is up 12% this week.', { stopReason: 'stop' }),
      ]);

      const ts = '1700001000.000001';
      const installation = buildInstallation();
      const payload = makeAppMentionPayload({ ts, text: `<@${TEST_BOT_USER_ID}> what is the revenue?` });

      await processSlackEvent(payload as any, installation);

      expect(postedMessages).toHaveLength(1);
      expect(postedMessages[0].channel).toBe(TEST_CHANNEL);
      expect(postedMessages[0].text).toBeTruthy();
      expect(postedMessages[0].thread_ts).toBe(ts);
    }, 60000);

    it('follow-up in the same thread continues the same conversation', async () => {
      const threadTs = '1700002000.000001';
      const installation = buildInstallation();

      // First message — creates thread binding
      slackFaux.setResponses([
        fauxAssistantMessage('Sales are up 12%.', { stopReason: 'stop' }),
      ]);
      await processSlackEvent(
        makeAppMentionPayload({ ts: threadTs, threadTs, eventId: `Ev_first_${Date.now()}`, text: `<@${TEST_BOT_USER_ID}> sales?` }) as any,
        installation,
      );
      expect(postedMessages).toHaveLength(1);
      expect(postedMessages[0].text).toBe('Sales are up 12%.');

      // Second message — same thread, different ts
      postedMessages.length = 0;
      // Use a faux factory to assert the orchestrator sent the follow-up text,
      // not the first message. This is the core of Bug #1: if the agent reads
      // ev.thread_ts's root message instead of ev.text, the messages array would end
      // with 'sales?' rather than 'and last week?'.
      slackFaux.setResponses([
        (context) => {
          const msgs = context.messages ?? [];
          const lastUserMsg = [...msgs].reverse().find((m: any) => m.role === 'user');
          // User message content is multi-block — extract text before substring check
          const rawContent = lastUserMsg?.content;
          const lastMsgText = Array.isArray(rawContent)
            ? rawContent.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
            : typeof rawContent === 'string' ? rawContent : '';
          if (!lastMsgText.includes('and last week?')) {
            throw new Error(
              `Expected last user message to contain "and last week?" but got: ${lastMsgText}`,
            );
          }
          return fauxAssistantMessage('Last week they were up 8%.', { stopReason: 'stop' });
        },
      ]);
      await processSlackEvent(
        makeAppMentionPayload({ ts: '1700002001.000001', threadTs, eventId: `Ev_second_${Date.now()}`, text: `<@${TEST_BOT_USER_ID}> and last week?` }) as any,
        installation,
      );
      expect(postedMessages).toHaveLength(1);
      // Reply must be the second response, not the first — proves the agent read
      // the follow-up message, not the thread root.
      expect(postedMessages[0].text).toBe('Last week they were up 8%.');

      // Only ONE v3 conversation should exist for this Slack thread (idempotent by meta.slackThreadKey)
      const { getModules } = await import('@/lib/modules/registry');
      const db = getModules().db;
      const threadKey = `slack:${TEST_TEAM_ID}:${TEST_CHANNEL}:${threadTs}`;
      const { rows } = await db.exec<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM conversations WHERE meta->>'slackThreadKey' = $1`,
        [threadKey],
      );
      expect(rows[0].cnt).toBe(1);

      // The conversation log must contain entries from BOTH messages — proves history
      // was appended rather than the conversation being reset on the follow-up.
      const { findConversationIdByMeta, getConversation, loadLog } = await import('@/lib/data/conversations.server');
      const convId = await findConversationIdByMeta('slackThreadKey', threadKey);
      expect(convId).not.toBeNull();
      const savedLog = await loadLog(convId!);
      // First message produces at least 2 log entries (root + result);
      // second message appends at least 2 more — so minimum 4 total.
      expect(savedLog.length).toBeGreaterThanOrEqual(4);

      // ConversationSource metadata must be stored so the conversation is identifiable as a Slack thread.
      const conv = await getConversation(convId!);
      expect((conv!.meta as { source?: unknown }).source).toEqual({
        type: 'slack',
        teamId: TEST_TEAM_ID,
        channelId: TEST_CHANNEL,
        threadTs,
      });
    }, 120000);

    it('direct message: agent replies and a v3 Slack conversation is stored', async () => {
      slackFaux.setResponses([
        fauxAssistantMessage('Hello! How can I help you today?', { stopReason: 'stop' }),
      ]);

      const ts = '1700005000.000001';
      const installation = buildInstallation();
      await processSlackEvent(makeDMPayload({ ts }) as any, installation);

      expect(postedMessages).toHaveLength(1);
      expect(postedMessages[0].text).toBeTruthy();
      expect(postedMessages[0].thread_ts).toBe(ts);

      // A v3 Slack conversation should exist for this thread.
      const { getModules } = await import('@/lib/modules/registry');
      const { rows } = await getModules().db.exec<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM conversations WHERE agent = 'SlackAgent' AND meta->>'slackThreadKey' LIKE '%${ts}'`,
        [],
      );
      expect(rows[0].cnt).toBeGreaterThanOrEqual(1);
    }, 60000);

    it('event dedup: the same event_id is processed only once', async () => {
      slackFaux.setResponses([
        fauxAssistantMessage('Here is your answer.', { stopReason: 'stop' }),
      ]);

      const eventId = `Ev_dedup_${Date.now()}`;
      const installation = buildInstallation();
      const payload = makeAppMentionPayload({
        eventId,
        ts: '1700003000.000001',
        text: `<@${TEST_BOT_USER_ID}> hello`,
      }) as any;

      // First call — agent runs and posts reply
      await processSlackEvent(payload, installation);
      expect(postedMessages).toHaveLength(1);

      // Second call with the same event_id — should be a no-op
      postedMessages.length = 0;
      await processSlackEvent(payload, installation);
      expect(postedMessages).toHaveLength(0);
    }, 60000);

    it('stale-answer guard: when current turn has no visible text, does NOT post a previous turn\'s answer', async () => {
      // This is the regression test for the bug where extractSlackReplyFromLog scanned
      // the full log and returned a previous turn's answer when the current turn had none.
      const threadTs = '1700006000.000001';
      const installation = buildInstallation();

      // Turn 1 — produces a visible answer stored in the conversation log
      slackFaux.setResponses([
        fauxAssistantMessage('The answer from turn one.', { stopReason: 'stop' }),
      ]);
      await processSlackEvent(
        makeAppMentionPayload({ ts: threadTs, threadTs, eventId: `Ev_stale_t1_${Date.now()}`, text: `<@${TEST_BOT_USER_ID}> question one` }) as any,
        installation,
      );
      expect(postedMessages[0].text).toBe('The answer from turn one.');

      // Turn 2 — LLM produces only <thinking> with no <answer> block (no visible text)
      postedMessages.length = 0;
      slackFaux.setResponses([
        fauxAssistantMessage(
          '<thinking>I need to query the database but I cannot right now.</thinking>',
          { stopReason: 'stop' },
        ),
      ]);
      await processSlackEvent(
        makeAppMentionPayload({ ts: '1700006001.000001', threadTs, eventId: `Ev_stale_t2_${Date.now()}`, text: `<@${TEST_BOT_USER_ID}> question two` }) as any,
        installation,
      );

      expect(postedMessages).toHaveLength(1);
      // Must NOT be the previous turn's answer — that was the bug.
      expect(postedMessages[0].text).not.toBe('The answer from turn one.');
      // Must be the honest fallback, not a stale reply.
      expect(postedMessages[0].text).toMatch(/do not have a text reply/i);
    }, 120000);

    it('agent can list DB connections and search files (not empty)', async () => {
      // The agent calls ListDBConnections + SearchFiles, then replies.
      slackFaux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall('ListDBConnections', {}),
            fauxToolCall('SearchFiles', { query: 'revenue' }),
          ],
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage('Here are your connections and reports.', { stopReason: 'stop' }),
      ]);

      const installation = buildInstallation();
      await processSlackEvent(
        makeAppMentionPayload({
          userId: TEST_ADMIN_USER_ID,
          ts: '1700009000.000001',
          eventId: `Ev_tools_${Date.now()}`,
          text: `<@${TEST_BOT_USER_ID}> show me revenue`,
        }) as any,
        installation,
      );

      // Pull the persisted conversation log and inspect the two tool results.
      const logJson = await latestSlackLogJson();

      // Bug #1 — ListDBConnections returned "[]" because ctx.connections was never
      // populated in the headless runner. The seeded connection must appear.
      expect(logJson).toContain(TEST_CONNECTION_NAME);

      // Bug #2 — SearchFiles returned {results:[],total:0} because the admin's
      // home_folder '/org' resolved to a non-existent '/org/org' search root.
      // The seeded question must appear in the results.
      expect(logJson).toContain(TEST_QUESTION_NAME);
    }, 60000);

    it('intermediate "talk to user" preamble does NOT end the run — posts the final answer', async () => {
      // Reproduces the reported symptom hypothesis: the model emits an intermediate
      // talk-to-user message ("Let me look that up...") ALONGSIDE a tool call
      // (stopReason 'toolUse'), then a real answer on the next step. The Slack path
      // must run the agent loop to completion and post the FINAL answer — NOT return
      // early on the intermediate preamble.
      slackFaux.setResponses([
        fauxAssistantMessage(
          [
            { type: 'text', text: 'Let me look that up for you.' },
            fauxToolCall('SearchFiles', { query: 'revenue' }),
          ],
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage('Found it: the Weekly Revenue Report.', { stopReason: 'stop' }),
      ]);

      const installation = buildInstallation();
      await processSlackEvent(
        makeAppMentionPayload({
          userId: TEST_ADMIN_USER_ID,
          ts: '1700010000.000001',
          eventId: `Ev_preamble_${Date.now()}`,
          text: `<@${TEST_BOT_USER_ID}> where is the revenue report?`,
        }) as any,
        installation,
      );

      expect(postedMessages).toHaveLength(1);
      // Must be the final answer (turn 2), never the intermediate preamble (turn 1).
      expect(postedMessages[0].text).toContain('Weekly Revenue Report');
      expect(postedMessages[0].text).not.toContain('Let me look that up');
    }, 60000);

    it('ReadFiles executes server-side in the headless path (not bridged → interrupted)', async () => {
      // Regression for the prod bug: the registered ReadFiles was the WebAnalystAgent
      // frontend-bridge variant (throws UserInputException), so in the headless Slack
      // path it never executed — it hung as a pending tool and got marked
      // "interrupted", leaving only the preamble to post. The headless path must use
      // the server-side ReadFiles so the loop completes and posts the real answer.
      const { getModules } = await import('@/lib/modules/registry');
      const { rows: idRows } = await getModules().db.exec<{ id: number }>(
        `SELECT id FROM files WHERE path = $1 LIMIT 1`,
        [`/org/${TEST_QUESTION_NAME}`],
      );
      const fileId = idRows[0].id;

      slackFaux.setResponses([
        fauxAssistantMessage(
          [
            { type: 'text', text: 'Let me pull up that file for you!' },
            fauxToolCall('ReadFiles', { fileIds: [fileId] }),
          ],
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage(`Found it — ${TEST_QUESTION_NAME}.`, { stopReason: 'stop' }),
      ]);

      const installation = buildInstallation();
      await processSlackEvent(
        makeAppMentionPayload({
          userId: TEST_ADMIN_USER_ID,
          ts: '1700011000.000001',
          eventId: `Ev_readfiles_${Date.now()}`,
          text: `<@${TEST_BOT_USER_ID}> can you access file ${fileId}?`,
        }) as any,
        installation,
      );

      expect(postedMessages).toHaveLength(1);
      // Must be the final answer — proves ReadFiles ran and the loop continued.
      // Before the fix, ReadFiles hung (UserInputException) and only the preamble
      // ("Let me pull up that file…") was posted.
      expect(postedMessages[0].text).toContain(TEST_QUESTION_NAME);
      expect(postedMessages[0].text).not.toContain('pull up that file');

      // And the persisted ReadFiles result must not be the "interrupted" dangler.
      const logJson = await latestSlackLogJson();
      expect(logJson).not.toContain('"result":"interrupted"');
    }, 60000);

    it('unknown MinusX user receives a polite error reply', async () => {
      const installation = buildInstallation();
      // TEST_UNKNOWN_USER_ID resolves to nobody@unknown.example which is not in the DB
      const payload = makeAppMentionPayload({
        userId: TEST_UNKNOWN_USER_ID,
        ts: '1700004000.000001',
        eventId: `Ev_unknown_${Date.now()}`,
        text: `<@${TEST_BOT_USER_ID}> hello`,
      }) as any;

      await processSlackEvent(payload, installation);

      expect(postedMessages).toHaveLength(1);
      // Should contain a helpful error message, not an empty string
      expect(postedMessages[0].text.length).toBeGreaterThan(0);
      expect(postedMessages[0].text.toLowerCase()).toMatch(/not configured|could not|sorry/);
    }, 30000);
  });
});
