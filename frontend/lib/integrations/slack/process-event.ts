/**
 * Slack event processing — the business logic behind
 * `POST /api/integrations/slack/events` (and the synthetic events built by
 * `POST /api/integrations/slack/interact`). The route(s) stay thin: parse +
 * verify the HTTP request, then hand off to `processSlackEvent` here.
 */
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { getUserEffectiveUser } from '@/lib/auth/auth-helpers';
import { runChatOrchestrationV2 } from '@/lib/chat/run-orchestration.server';
import { checkCreditGate } from '@/lib/analytics/credit-usage.server';
import { SlackAgent } from '@/agents/slack/slack-agent';
import {
  addReaction,
  getConversationHistory,
  getSlackUserEmail,
  postSlackMessage,
  publishHomeView,
  removeReaction,
  uploadSlackFile,
} from '@/lib/integrations/slack/api';
import { buildSlackAgentArgs } from '@/lib/integrations/slack/context';
import { resolveBaseUrl } from '@/lib/jobs/job-utils';
import {
  extractSlackReply,
  extractQueryCharts,
  markdownToSlackMrkdwn,
  buildSlackReplyBlocks,
  normalizeSlackPrompt,
} from '@/lib/integrations/slack/messages';
import { serverChartImageRenderer } from '@/lib/chart/ChartImageRenderer.server';
import { getBrandLogoUrl, getBrandLogoExpandedUrl } from '@/lib/branding/whitelabel';
import { buildHomeView, buildWelcomeBlocks, shouldSendWelcome } from '@/lib/integrations/slack/welcome';
import {
  getOrCreateSlackConversationId,
  markSlackEventDone,
  reserveSlackEvent,
  type SlackInstallationMatch,
} from '@/lib/integrations/slack/store';

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

export function getTeamId(payload: SlackEventEnvelope): string | null {
  return payload.team_id ?? payload.authorizations?.[0]?.team_id ?? null;
}

export function isSupportedEvent(payload: SlackEventEnvelope): boolean {
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
  publicBaseUrl?: string,
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
        const platformUrl = await resolveBaseUrl();
        const logoUrl = new URL(getBrandLogoExpandedUrl(installation.config.branding, 'light'), platformUrl).toString();
        const homeView = buildHomeView(appName, platformUrl, logoUrl, installation.config.links?.docsUrl);
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

    const effectiveUser = await getUserEffectiveUser(
      slackEmail,
      installation.mode,
    );
    if (!effectiveUser) {      await postErrorReply(
        installation,
        ev.channel,
        threadTs,
        `Sorry, ${slackEmail} is not configured in ${installation.config.branding?.agentName || 'MinusX'}.`,
      );
      return;
    }

    appEventRegistry.publish(AppEvents.USER_MESSAGE, {
      source: 'slack',
      userId: effectiveUser.userId,
      userEmail: effectiveUser.email,
      messagePreview: userMessage.slice(0, 100),
      mode: installation.mode,
    });

    const teamId = installation.bot.team_id ?? getTeamId(payload) ?? '';
    const conversationId = await getOrCreateSlackConversationId(
      effectiveUser,
      teamId,
      ev.channel,
      threadTs,
      userMessage,
    );

    // Credit gate: when enforced + exceeded, post the block message and skip the run.
    const gate = await checkCreditGate(effectiveUser);
    if (!gate.allowed) {
      await postErrorReply(installation, ev.channel, threadTs, gate.message!);
      return;
    }

    const agentArgs = await buildSlackAgentArgs(effectiveUser);

    const result = await runChatOrchestrationV2({
      agentClass: SlackAgent,
      agent_args: agentArgs,
      user: effectiveUser,
      userMessage,
      conversationId,
    });

    const slackReply = extractSlackReply(result.logDiff);
    const fallbackText = 'I finished the run, but I do not have a text reply to post back.';

    if (slackReply) {
      const mrkdwnText = markdownToSlackMrkdwn(slackReply.text);
      const baseUrl = publicBaseUrl ?? await resolveBaseUrl();
      const viewUrl = `${baseUrl}/explore/${conversationId}`;

      // Upload chart images first (max 2) so they appear before the text reply
      const queryCharts = extractQueryCharts(result.logDiff);
      const renderedCharts = await serverChartImageRenderer.renderCharts(
        queryCharts.map(c => ({ queryResult: c.queryResult, vizSettings: c.vizSettings })),
        { width: 1024, colorMode: 'dark', addWatermark: true, padding: true, logoSrc: getBrandLogoUrl(installation.config.branding, 'dark') },
      ).catch(err => { console.warn('[Slack] Chart rendering failed:', err); return []; });
      for (const rendered of renderedCharts) {
        try {
          const base64Data = rendered.dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const chartJpeg = Buffer.from(base64Data, 'base64');
          await uploadSlackFile(installation.bot.bot_token, {
            channel: ev.channel,
            threadTs,
            filename: 'chart.jpg',
            fileData: chartJpeg,
          });
        } catch (err) {
          console.warn('[Slack] Chart upload failed:', err);
        }
      }

      // Then send the text reply with trust info, suggested follow-ups, and "View in <app>" button
      const blocks = buildSlackReplyBlocks({
        text: mrkdwnText,
        suggestedQuestions: slackReply.suggestedQuestions,
        trustInfo: slackReply.trustInfo,
        viewUrl,
        appName: installation.config.branding?.agentName || 'MinusX',
      });

      await postSlackMessage(installation.bot.bot_token, {
        channel: ev.channel,
        text: slackReply.text,
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
    appEventRegistry.publish(AppEvents.ERROR, {
      source: 'slack_events',
      message: err instanceof Error ? err.message : String(err),
      error: err,
      mode: installation.mode,
    });
    // On error, swap :eyes: for :x:
    if (ev?.channel && ev?.ts) {
      await removeReaction(installation.bot.bot_token, ev.channel, ev.ts, 'eyes').catch(() => {});
      await addReaction(installation.bot.bot_token, ev.channel, ev.ts, 'x').catch(() => {});
    }
    if (eventId) markSlackEventDone(eventId);
  }
}
