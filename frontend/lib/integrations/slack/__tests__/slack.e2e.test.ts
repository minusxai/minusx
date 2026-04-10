/**
 * Slack Bot Integration — E2E Tests
 *
 * Tests the full Slack event → MinusX agent → Slack reply flow.
 * Only LLM calls are mocked (via LLM mock server); everything else is real
 * (SQLite DB, Python backend, Slack API calls mocked via fetch interceptors).
 *
 * Run: npm test -- lib/integrations/slack/__tests__/slack.e2e.test.ts
 */

// ============================================================================
// DB mock — MUST be declared before any imports (Jest hoisting)
// ============================================================================
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_slack_e2e.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
  };
});

import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { POST, processSlackEvent } from '@/app/api/integrations/slack/events/route';
import type { SlackInstallationMatch } from '@/lib/integrations/slack/store';
import { withPythonBackend } from '@/test/harness/python-backend';
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

// ============================================================================
// DB fixture setup
// ============================================================================

async function addSlackTestFixtures(dbPath: string): Promise<void> {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
  const now = new Date().toISOString();

  // Determine next safe file ID after template-seeded files
  const { rows: [{ next_id }] } = await db.query<{ next_id: number }>(
    'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files WHERE company_id = 1',
    []
  );

  // /org/configs folder and /org/configs/config already exist (created by initTestDatabase
  // via company-template.json). Update the config content with the slack bot configuration.
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
  await db.query(
    `UPDATE files SET content = $1 WHERE company_id = 1 AND path = $2`,
    [JSON.stringify(configContent), '/org/configs/config']
  );

  // MinusX user whose email matches the Slack user.
  // id=1 is already created by initTestDatabase (template admin), so use id=2.
  await db.query(
    `INSERT INTO users (id, email, name, password_hash, phone, state, home_folder, role, company_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [2, TEST_EMAIL, 'Slack Test User', null, null, null, '', 'viewer', 1, now, now]
  );

  await db.close();
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
    companyId: 1,
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

const USAGE = { total_tokens: 50, prompt_tokens: 30, completion_tokens: 20 };

// ============================================================================
// Test suite
// ============================================================================

describe('Slack Bot Integration', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });

  // Records every chat.postMessage call made during a test
  const postedMessages: Array<{ channel: string; text: string; thread_ts?: string }> = [];

  // ── Fetch mock ──────────────────────────────────────────────────────────────
  setupMockFetch({
    getPythonPort,
    getLLMMockPort,
    additionalInterceptors: [
      async (urlStr: string, init?: RequestInit) => {
        // Slack users.info
        if (urlStr.includes('slack.com/api/users.info')) {
          const qs = new URLSearchParams(urlStr.split('?')[1] ?? '');
          const userId = qs.get('user');
          const email = userId === TEST_USER_ID ? TEST_EMAIL : 'nobody@unknown.example';
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

  beforeEach(async () => {
    postedMessages.length = 0;
    await getLLMMockServer!().reset();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Suite 1 — HTTP route layer (no Python needed, returns before async work)
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
      await getLLMMockServer!().configure({
        response: {
          content: 'Revenue is up 12% this week.',
          role: 'assistant',
          finish_reason: 'stop',
        },
        usage: USAGE,
      });

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
      await getLLMMockServer!().configure({
        response: { content: 'Sales are up 12%.', role: 'assistant', finish_reason: 'stop' },
        usage: USAGE,
      });
      await processSlackEvent(
        makeAppMentionPayload({ ts: threadTs, threadTs, eventId: `Ev_first_${Date.now()}`, text: `<@${TEST_BOT_USER_ID}> sales?` }) as any,
        installation,
      );
      expect(postedMessages).toHaveLength(1);
      expect(postedMessages[0].text).toBe('Sales are up 12%.');

      // Second message — same thread, different ts
      postedMessages.length = 0;
      await getLLMMockServer!().configure({
        // Use validateRequest to assert the Python backend received the follow-up text,
        // not the first message. This is the core of Bug #1: if the agent reads
        // ev.thread_ts's root message instead of ev.text, the messages array would end
        // with 'sales?' rather than 'and last week?'.
        validateRequest: (req) => {
          const msgs = req.messages ?? [];
          const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
          if (!lastUserMsg?.content?.includes('and last week?')) {
            throw new Error(
              `Expected last user message to contain "and last week?" but got: ${lastUserMsg?.content}`,
            );
          }
        },
        response: { content: 'Last week they were up 8%.', role: 'assistant', finish_reason: 'stop' },
        usage: USAGE,
      });
      await processSlackEvent(
        makeAppMentionPayload({ ts: '1700002001.000001', threadTs, eventId: `Ev_second_${Date.now()}`, text: `<@${TEST_BOT_USER_ID}> and last week?` }) as any,
        installation,
      );
      expect(postedMessages).toHaveLength(1);
      // Reply must be the second response, not the first — proves the agent read
      // the follow-up message, not the thread root.
      expect(postedMessages[0].text).toBe('Last week they were up 8%.');

      // Only ONE conversation file should exist at the Slack path
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
      const { rows } = await db.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM files WHERE company_id = 1 AND type = 'conversation' AND path LIKE '%/logs/conversations/%/slack-%'`,
        [],
      );
      expect(rows[0].cnt).toBe(1);

      // The conversation log must contain entries from BOTH messages — proves history
      // was appended rather than the file being reset on the follow-up.
      const { rows: [fileRow] } = await db.query<{ content: string }>(
        `SELECT content FROM files WHERE company_id = 1 AND type = 'conversation' AND path LIKE '%/logs/conversations/%/slack-%' LIMIT 1`,
        [],
      );
      await db.close();
      const content = JSON.parse(fileRow.content) as {
        log: unknown[];
        metadata: { source?: { type: string; teamId: string; channelId: string; threadTs: string } };
      };
      // First message produces at least 2 log entries (task + task_result);
      // second message appends at least 2 more — so minimum 4 total.
      expect(content.log.length).toBeGreaterThanOrEqual(4);

      // ConversationSource metadata must be stored so the file is identifiable as a Slack thread.
      expect(content.metadata.source).toEqual({
        type: 'slack',
        teamId: TEST_TEAM_ID,
        channelId: TEST_CHANNEL,
        threadTs,
      });
    }, 120000);

    it('direct message: agent replies and conversation file is stored at user path', async () => {
      await getLLMMockServer!().configure({
        response: { content: 'Hello! How can I help you today?', role: 'assistant', finish_reason: 'stop' },
        usage: USAGE,
      });

      const ts = '1700005000.000001';
      const installation = buildInstallation();
      await processSlackEvent(makeDMPayload({ ts }) as any, installation);

      expect(postedMessages).toHaveLength(1);
      expect(postedMessages[0].text).toBeTruthy();
      expect(postedMessages[0].thread_ts).toBe(ts);

      // File should be stored under the user's conversation folder, not a separate slack folder
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
      const { rows } = await db.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM files WHERE company_id = 1 AND type = 'conversation' AND path LIKE '%/logs/conversations/%/slack-%'`,
        [],
      );
      await db.close();
      expect(rows[0].cnt).toBeGreaterThanOrEqual(1);
    }, 60000);

    it('event dedup: the same event_id is processed only once', async () => {
      await getLLMMockServer!().configure({
        response: { content: 'Here is your answer.', role: 'assistant', finish_reason: 'stop' },
        usage: USAGE,
      });

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
      await getLLMMockServer!().configure({
        response: { content: 'The answer from turn one.', role: 'assistant', finish_reason: 'stop' },
        usage: USAGE,
      });
      await processSlackEvent(
        makeAppMentionPayload({ ts: threadTs, threadTs, eventId: `Ev_stale_t1_${Date.now()}`, text: `<@${TEST_BOT_USER_ID}> question one` }) as any,
        installation,
      );
      expect(postedMessages[0].text).toBe('The answer from turn one.');

      // Turn 2 — LLM produces only <thinking> with no <answer> block (no visible text)
      postedMessages.length = 0;
      await getLLMMockServer!().configure({
        response: {
          content: '<thinking>I need to query the database but I cannot right now.</thinking>',
          role: 'assistant',
          finish_reason: 'stop',
        },
        usage: USAGE,
      });
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
