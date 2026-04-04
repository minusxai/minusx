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

/**
 * Upload a file to Slack and share it in a channel/thread.
 *
 * 3-step flow per Slack docs:
 * 1. files.getUploadURLExternal → get temporary upload URL
 * 2. POST file bytes to that URL
 * 3. files.completeUploadExternal → share into channel/thread
 */
export async function uploadSlackFile(
  token: string,
  opts: {
    channel: string;
    threadTs?: string;
    filename: string;
    fileData: Buffer;
  },
): Promise<{ fileId: string }> {
  const data = Buffer.from(opts.fileData);

  // Step 1: Get upload URL
  const step1 = await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      filename: opts.filename,
      length: String(data.length),
    }),
  });
  const { ok: ok1, upload_url, file_id, error: err1 } = await step1.json() as {
    ok: boolean; upload_url: string; file_id: string; error?: string;
  };
  if (!ok1) {
    throw new Error(`Slack files.getUploadURLExternal failed: ${err1}`);
  }

  // Step 2: POST file bytes to the upload URL
  await fetch(upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([data]),
  });

  // Step 3: Complete upload and share to channel/thread
  const completeBody: Record<string, unknown> = {
    files: [{ id: file_id, title: opts.filename }],
    channel_id: opts.channel,
  };
  if (opts.threadTs) {
    completeBody.thread_ts = opts.threadTs;
  }

  const step3 = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(completeBody),
  });
  const { ok: ok3, files, error: err3 } = await step3.json() as {
    ok: boolean; files?: Array<{ id: string }>; error?: string;
  };
  if (!ok3) {
    throw new Error(`Slack files.completeUploadExternal failed: ${err3}`);
  }

  return { fileId: files?.[0]?.id || file_id };
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

export async function publishHomeView(
  token: string,
  userId: string,
  view: unknown,
): Promise<void> {
  const result = await slackApiFetch<Record<string, never>>('views.publish', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, view }),
  });
  if (!result.ok) {
    console.warn(`[Slack] views.publish failed: ${result.error}`);
  }
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

export async function addReaction(
  token: string,
  channel: string,
  timestamp: string,
  emoji: string,
): Promise<void> {
  const result = await slackApiFetch<Record<string, never>>('reactions.add', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, timestamp, name: emoji }),
  });
  // Silently ignore "already_reacted" errors
  if (!result.ok && result.error !== 'already_reacted') {
    console.warn(`[Slack] reactions.add failed: ${result.error}`);
  }
}

export async function removeReaction(
  token: string,
  channel: string,
  timestamp: string,
  emoji: string,
): Promise<void> {
  const result = await slackApiFetch<Record<string, never>>('reactions.remove', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, timestamp, name: emoji }),
  });
  // Silently ignore "no_reaction" errors
  if (!result.ok && result.error !== 'no_reaction') {
    console.warn(`[Slack] reactions.remove failed: ${result.error}`);
  }
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
