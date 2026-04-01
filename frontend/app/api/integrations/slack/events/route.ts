import { after, NextRequest, NextResponse } from 'next/server';
import { getCompanyUserEffectiveUser } from '@/lib/auth/auth-helpers';
import { runChatOrchestration } from '@/lib/chat/run-orchestration';
import { getSlackUserEmail, postSlackMessage, verifySlackRequestSignature } from '@/lib/integrations/slack/api';
import { getSlackSigningSecret } from '@/lib/integrations/slack/config';
import { buildSlackAgentArgs } from '@/lib/integrations/slack/context';
import { extractSlackReplyFromLog, normalizeSlackPrompt } from '@/lib/integrations/slack/messages';
import {
  findSlackInstallationByTeam,
  getThreadConversationId,
  markSlackEventStatus,
  reserveSlackEvent,
  setThreadConversationId,
  type SlackInstallationMatch,
} from '@/lib/integrations/slack/store';

export const runtime = 'nodejs';

interface SlackEventEnvelope {
  type: 'url_verification' | 'event_callback';
  challenge?: string;
  team_id?: string;
  event_id?: string;
  authorizations?: Array<{ team_id?: string }>;
  event?: {
    type?: string;
    subtype?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    thread_ts?: string;
    ts?: string;
  };
}

function getTeamId(payload: SlackEventEnvelope): string | null {
  return payload.team_id || payload.authorizations?.[0]?.team_id || null;
}

function isSupportedEvent(payload: SlackEventEnvelope): boolean {
  const event = payload.event;
  if (!event?.type) return false;
  if (event.subtype || event.bot_id) return false;
  if (event.type === 'app_mention') return true;
  return event.type === 'message' && event.channel_type === 'im';
}

async function postSlackErrorReply(
  installation: SlackInstallationMatch,
  channel: string,
  threadTs: string,
  text: string,
): Promise<void> {
  await postSlackMessage(installation.bot.bot_token, {
    channel,
    text,
    thread_ts: threadTs,
  });
}

async function processSlackEvent(payload: SlackEventEnvelope, installation: SlackInstallationMatch): Promise<void> {
  const event = payload.event;
  const eventId = payload.event_id;

  try {
    if (!event?.channel || !event.ts || !event.text) {
      if (eventId) {
        await markSlackEventStatus(installation.companyId, installation.mode, eventId, 'failed');
      }
      return;
    }

    const userMessage = normalizeSlackPrompt(event.text, installation.bot.bot_user_id);
    if (!userMessage) {
      if (eventId) {
        await markSlackEventStatus(installation.companyId, installation.mode, eventId, 'completed');
      }
      return;
    }

    const threadTs = event.thread_ts || event.ts;
    if (!event.user) {
      await postSlackErrorReply(
        installation,
        event.channel,
        threadTs,
        'Sorry, I could not identify your Slack user for this message.',
      );
      if (eventId) {
        await markSlackEventStatus(installation.companyId, installation.mode, eventId, 'completed');
      }
      return;
    }

    const slackUserEmail = await getSlackUserEmail(installation.bot.bot_token, event.user);
    if (!slackUserEmail) {
      await postSlackErrorReply(
        installation,
        event.channel,
        threadTs,
        'Sorry, I could not read your Slack email. Make sure your Slack profile has an email address and try again.',
      );
      if (eventId) {
        await markSlackEventStatus(installation.companyId, installation.mode, eventId, 'completed');
      }
      return;
    }

    const effectiveUser = await getCompanyUserEffectiveUser(
      installation.companyId,
      slackUserEmail,
      installation.mode,
    );

    if (!effectiveUser) {
      await postSlackErrorReply(
        installation,
        event.channel,
        threadTs,
        `Sorry, ${slackUserEmail} is not configured in MinusX for this company.`,
      );
      if (eventId) {
        await markSlackEventStatus(installation.companyId, installation.mode, eventId, 'completed');
      }
      return;
    }

    const conversationId = await getThreadConversationId(
      installation.companyId,
      installation.mode,
      event.channel,
      threadTs,
    );

    const agentArgs = await buildSlackAgentArgs(effectiveUser);

    const result = await runChatOrchestration({
      agent: 'SlackAgent',
      agent_args: agentArgs,
      user: effectiveUser,
      userMessage,
      conversationId,
      conversationNamePrefix: '[Slack] ',
    });

    await setThreadConversationId(
      installation.companyId,
      installation.mode,
      event.channel,
      threadTs,
      result.conversationId,
    );

    const reply = extractSlackReplyFromLog(result.log) || 'I finished the run, but I do not have a text reply to post back.';

    await postSlackMessage(installation.bot.bot_token, {
      channel: event.channel,
      text: reply,
      thread_ts: threadTs,
    });

    if (eventId) {
      await markSlackEventStatus(installation.companyId, installation.mode, eventId, 'completed');
    }
  } catch (error) {
    console.error('[Slack events] Failed to process event', error);
    if (eventId) {
      await markSlackEventStatus(installation.companyId, installation.mode, eventId, 'failed');
    }
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const payload = JSON.parse(rawBody) as SlackEventEnvelope;
  const teamId = getTeamId(payload);
  const installation = teamId ? await findSlackInstallationByTeam(teamId) : null;
  const signingSecret = installation?.bot.signing_secret || getSlackSigningSecret();

  if (!signingSecret) {
    return NextResponse.json({ ok: true });
  }

  const isValid = verifySlackRequestSignature({
    rawBody,
    timestamp: request.headers.get('x-slack-request-timestamp'),
    signature: request.headers.get('x-slack-signature'),
    signingSecret,
  });

  if (!isValid) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (payload.type === 'url_verification' && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== 'event_callback' || !isSupportedEvent(payload)) {
    return NextResponse.json({ ok: true });
  }

  if (!teamId) {
    return NextResponse.json({ ok: true });
  }

  if (!installation) {
    return NextResponse.json({ ok: true });
  }

  if (payload.event_id) {
    const reserved = await reserveSlackEvent(installation.companyId, installation.mode, payload.event_id);
    if (!reserved) {
      return NextResponse.json({ ok: true });
    }
  }

  after(() => processSlackEvent(payload, installation));

  return NextResponse.json({ ok: true });
}
