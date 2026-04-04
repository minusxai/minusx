import { after, NextRequest, NextResponse } from 'next/server';
import { getCompanyUserEffectiveUser } from '@/lib/auth/auth-helpers';
import { runChatOrchestration } from '@/lib/chat/run-orchestration';
import { addReaction, getConversationHistory, getSlackUserEmail, postSlackMessage, publishHomeView, removeReaction, verifySlackRequestSignature } from '@/lib/integrations/slack/api';
import { getSlackSigningSecret } from '@/lib/integrations/slack/config';
import { buildSlackAgentArgs } from '@/lib/integrations/slack/context';
import { resolveBaseUrl } from '@/lib/jobs/job-utils';
import { extractSlackReply, markdownToSlackMrkdwn, buildSlackReplyBlocks, normalizeSlackPrompt } from '@/lib/integrations/slack/messages';
import { buildHomeView, buildWelcomeBlocks, shouldSendWelcome } from '@/lib/integrations/slack/welcome';
import {
  findSlackInstallationByTeam,
  getOrCreateSlackConversationId,
  markSlackEventDone,
  reserveSlackEvent,
  type SlackInstallationMatch,
} from '@/lib/integrations/slack/store';

export const runtime = 'nodejs';

export interface SlackEventEnvelope {
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
    tab?: string;
  };
}

function getTeamId(payload: SlackEventEnvelope): string | null {
  return payload.team_id ?? payload.authorizations?.[0]?.team_id ?? null;
}

function isSupportedEvent(payload: SlackEventEnvelope): boolean {
  const ev = payload.event;
  if (!ev?.type) return false;
  if (ev.type === 'app_home_opened') return true;
  if (ev.subtype || ev.bot_id) return false;
  if (ev.type === 'app_mention') return true;
  return ev.type === 'message' && ev.channel_type === 'im';
}

async function postErrorReply(
  installation: SlackInstallationMatch,
  channel: string,
  threadTs: string,
  text: string,
): Promise<void> {
  await postSlackMessage(installation.bot.bot_token, { channel, text, thread_ts: threadTs });
}

/** Exported so tests can call it directly, bypassing the after() async boundary. */
export async function processSlackEvent(
  payload: SlackEventEnvelope,
  installation: SlackInstallationMatch,
): Promise<void> {
  const ev = payload.event;
  const eventId = payload.event_id;

  // Dedup here so direct test calls also benefit (HTTP path calls reserveSlackEvent before after())
  if (eventId && !reserveSlackEvent(eventId)) return;

  try {
    // Handle app_home_opened — publish Home tab or send welcome DM
    if (ev?.type === 'app_home_opened') {
      if (ev.tab === 'home' && ev.user) {
        const appName = installation.config.branding?.agentName || 'MinusX';
        const platformUrl = await resolveBaseUrl(installation.companyId);
        const homeView = buildHomeView(appName, platformUrl);
        await publishHomeView(installation.bot.bot_token, ev.user, homeView);
        if (eventId) markSlackEventDone(eventId);
        return;
      }
    }

    if (ev?.type === 'app_home_opened' && ev.tab === 'messages') {
      const channel = ev.channel || ev.user;
      if (channel) {
        const teamId = installation.bot.team_id ?? getTeamId(payload) ?? '';
        // In-memory check first (fast path), then verify via Slack API
        if (ev.user && teamId && shouldSendWelcome(teamId, ev.user)) {
          const { messages } = await getConversationHistory(installation.bot.bot_token, channel, 1);
          if (messages.length === 0) {
            const appName = installation.config.branding?.agentName || 'MinusX';
            const { text, blocks } = buildWelcomeBlocks(appName);
            await postSlackMessage(installation.bot.bot_token, {
              channel,
              text,
              blocks,
            });
          }
        }
      }
      if (eventId) markSlackEventDone(eventId);
      return;
    }

    if (!ev?.channel || !ev.ts || !ev.text) return;

    const userMessage = normalizeSlackPrompt(ev.text, installation.bot.bot_user_id);
    if (!userMessage) return;

    const threadTs = ev.thread_ts ?? ev.ts;

    // React with :eyes: to acknowledge we're working on it
    await addReaction(installation.bot.bot_token, ev.channel, ev.ts, 'eyes');

    if (!ev.user) {
      await postErrorReply(
        installation,
        ev.channel,
        threadTs,
        'Sorry, I could not identify your Slack user for this message.',
      );
      return;
    }

    const slackEmail = await getSlackUserEmail(installation.bot.bot_token, ev.user);
    if (!slackEmail) {
      await postErrorReply(
        installation,
        ev.channel,
        threadTs,
        'Sorry, I could not read your Slack email. Make sure your Slack profile has an email address and try again.',
      );
      return;
    }

    const effectiveUser = await getCompanyUserEffectiveUser(
      installation.companyId,
      slackEmail,
      installation.mode,
    );
    if (!effectiveUser) {
      await postErrorReply(
        installation,
        ev.channel,
        threadTs,
        `Sorry, ${slackEmail} is not configured in MinusX for this company.`,
      );
      return;
    }

    const teamId = installation.bot.team_id ?? getTeamId(payload) ?? '';
    const conversationId = await getOrCreateSlackConversationId(
      effectiveUser,
      teamId,
      ev.channel,
      threadTs,
      userMessage,
    );

    const agentArgs = await buildSlackAgentArgs(effectiveUser);

    const result = await runChatOrchestration({
      agent: 'SlackAgent',
      agent_args: agentArgs,
      user: effectiveUser,
      userMessage,
      conversationId,
    });

    const slackReply = extractSlackReply(result.logDiff);
    const fallbackText = 'I finished the run, but I do not have a text reply to post back.';

    if (slackReply) {
      const mrkdwnText = markdownToSlackMrkdwn(slackReply.text);
      const baseUrl = await resolveBaseUrl(installation.companyId);
      const viewUrl = `${baseUrl}/explore/${conversationId}`;
      const blocks = buildSlackReplyBlocks({
        text: mrkdwnText,
        // images: ['https://docsv2.minusx.ai/dark/dashboard.png'],
        viewUrl,
      });

      await postSlackMessage(installation.bot.bot_token, {
        channel: ev.channel,
        text: slackReply.text, // plain text fallback for notifications
        thread_ts: threadTs,
        blocks,
      });
    } else {
      await postSlackMessage(installation.bot.bot_token, {
        channel: ev.channel,
        text: fallbackText,
        thread_ts: threadTs,
      });
    }

    // Swap :eyes: for :white_check_mark:
    await removeReaction(installation.bot.bot_token, ev.channel, ev.ts, 'eyes');
    await addReaction(installation.bot.bot_token, ev.channel, ev.ts, 'white_check_mark');

    if (eventId) markSlackEventDone(eventId);
  } catch (err) {
    console.error('[Slack events] Failed to process event', err);
    // On error, swap :eyes: for :x:
    if (ev?.channel && ev?.ts) {
      await removeReaction(installation.bot.bot_token, ev.channel, ev.ts, 'eyes').catch(() => {});
      await addReaction(installation.bot.bot_token, ev.channel, ev.ts, 'x').catch(() => {});
    }
    if (eventId) markSlackEventDone(eventId);
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const teamId = getTeamId(payload);
  const installation = teamId ? await findSlackInstallationByTeam(teamId) : null;
  const signingSecret = installation?.bot.signing_secret ?? getSlackSigningSecret();

  if (signingSecret) {
    const isValid = verifySlackRequestSignature({
      rawBody,
      timestamp: request.headers.get('x-slack-request-timestamp'),
      signature: request.headers.get('x-slack-signature'),
      signingSecret,
    });

    if (!isValid) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  // URL verification handshake (Slack calls this when you save the webhook URL)
  // Handled regardless of whether a signing secret was found, so initial setup works.
  if (payload.type === 'url_verification' && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // If we have no signing secret at all, silently accept remaining events (prevents blocking setup)
  if (!signingSecret) {
    return NextResponse.json({ ok: true });
  }

  if (payload.type !== 'event_callback' || !isSupportedEvent(payload)) {
    return NextResponse.json({ ok: true });
  }

  if (!teamId || !installation) {
    return NextResponse.json({ ok: true });
  }

  // Process asynchronously so Slack doesn't time out waiting for the agent
  // processSlackEvent handles event deduplication internally via reserveSlackEvent
  after(() => processSlackEvent(payload, installation));

  return NextResponse.json({ ok: true });
}
