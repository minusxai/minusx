import 'server-only';
import crypto from 'crypto';

type SlackApiSuccess<T> = { ok: true } & T;
type SlackApiFailure = { ok: false; error: string };
type SlackApiResponse<T> = SlackApiSuccess<T> | SlackApiFailure;

export interface SlackAuthTestResponse {
  url: string;
  team: string;
  user: string;
  team_id: string;
  user_id: string;
  bot_id?: string;
}

interface SlackUserInfoResponse {
  user?: {
    profile?: {
      email?: string;
    };
  };
}

async function slackApiFetch<T>(
  path: string,
  init: RequestInit,
): Promise<SlackApiResponse<T>> {
  const response = await fetch(`https://slack.com/api/${path}`, init);
  const data = await response.json() as SlackApiResponse<T>;

  if (!response.ok) {
    return {
      ok: false,
      error: `slack_http_${response.status}`,
    };
  }

  return data;
}

export async function slackAuthTest(token: string): Promise<SlackAuthTestResponse> {
  const result = await slackApiFetch<SlackAuthTestResponse>('auth.test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!result.ok) {
    throw new Error(`Slack auth.test failed: ${result.error}`);
  }

  return result;
}

export async function postSlackMessage(
  token: string,
  body: {
    channel: string;
    text: string;
    thread_ts?: string;
    blocks?: unknown[];
  },
): Promise<{ ts: string }> {
  const result = await slackApiFetch<{ ts: string }>('chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    throw new Error(`Slack chat.postMessage failed: ${result.error}`);
  }

  return { ts: result.ts };
}

export async function getSlackUserEmail(token: string, userId: string): Promise<string | null> {
  const query = new URLSearchParams({ user: userId });
  const result = await slackApiFetch<SlackUserInfoResponse>(`users.info?${query.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!result.ok) {
    throw new Error(`Slack users.info failed: ${result.error}`);
  }

  return result.user?.profile?.email?.trim() || null;
}

export async function getConversationHistory(
  token: string,
  channel: string,
  limit: number = 1,
): Promise<{ messages: Array<{ bot_id?: string; text?: string }> }> {
  const query = new URLSearchParams({ channel, limit: limit.toString() });
  const result = await slackApiFetch<{ messages: Array<{ bot_id?: string; text?: string }> }>(
    `conversations.history?${query.toString()}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!result.ok) {
    throw new Error(`Slack conversations.history failed: ${result.error}`);
  }
  return { messages: result.messages ?? [] };
}

export function verifySlackRequestSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  signingSecret: string;
}): boolean {
  const { rawBody, timestamp, signature, signingSecret } = input;

  if (!timestamp || !signature) {
    return false;
  }

  const timestampInt = parseInt(timestamp, 10);
  if (!Number.isFinite(timestampInt)) {
    return false;
  }

  if (Math.abs(Math.floor(Date.now() / 1000) - timestampInt) > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;

  const expected = Buffer.from(digest, 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}
