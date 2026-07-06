import { after, NextRequest, NextResponse } from 'next/server';
import { getModules } from '@/lib/modules/registry';
import { verifySlackRequestSignature } from '@/lib/integrations/slack/api';
import { getSlackSigningSecret } from '@/lib/integrations/slack/config';
import { findSlackInstallationByTeam } from '@/lib/integrations/slack/store';
import {
  getTeamId,
  isSupportedEvent,
  processSlackEvent,
  type SlackEventEnvelope,
} from '@/lib/integrations/slack/process-event';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // URL verification handshake must be answered before any DB lookups — Slack calls this
  // during initial webhook setup when the team may not yet be registered.
  if (payload.type === 'url_verification' && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const teamId = getTeamId(payload);
  const contextEstablished = teamId
    ? await getModules().auth.addHeaders(request, new Headers(), { slack_team: teamId })
    : true;

  if (!contextEstablished) {
    console.log('[Slack/events] dropping: unknown team', { teamId });
    return NextResponse.json({ ok: true });
  }

  const runInContext = (await getModules().auth.getContextRunner?.()) ?? ((fn: () => Promise<unknown>) => fn());
  const installation = teamId ? await findSlackInstallationByTeam(teamId) : null;
  const signingSecret = installation?.bot.signing_secret ?? getSlackSigningSecret();

  console.log('[Slack/events] received', {
    type: payload.type,
    teamId,
    eventType: payload.event?.type,
    eventSubtype: payload.event?.subtype,
    channelType: payload.event?.channel_type,
    botId: payload.event?.bot_id,
    installationFound: !!installation,
    signingSecretSource: installation?.bot.signing_secret ? 'installation' : signingSecret ? 'env' : 'none',
  });

  if (signingSecret) {
    const isValid = verifySlackRequestSignature({
      rawBody,
      timestamp: request.headers.get('x-slack-request-timestamp'),
      signature: request.headers.get('x-slack-signature'),
      signingSecret,
    });

    if (!isValid) {
      console.log('[Slack/events] dropping: invalid signature');
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  // If we have no signing secret at all, silently accept remaining events (prevents blocking setup)
  if (!signingSecret) {
    console.log('[Slack/events] dropping: no signing secret configured');
    return NextResponse.json({ ok: true });
  }

  if (payload.type !== 'event_callback' || !isSupportedEvent(payload)) {
    console.log('[Slack/events] dropping: unsupported event', {
      payloadType: payload.type,
      eventType: payload.event?.type,
      eventSubtype: payload.event?.subtype,
      channelType: payload.event?.channel_type,
      botId: payload.event?.bot_id,
      reason: payload.type !== 'event_callback' ? 'not event_callback' : 'isSupportedEvent=false',
    });
    return NextResponse.json({ ok: true });
  }

  if (!teamId || !installation) {
    console.log('[Slack/events] dropping: installation not found', { teamId, installationFound: !!installation });
    return NextResponse.json({ ok: true });
  }

  // Process asynchronously so Slack doesn't time out waiting for the agent
  // processSlackEvent handles event deduplication internally via reserveSlackEvent
  const forwardedProto = (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'https')
    .split(',')[0]
    .trim();
  const host = request.headers.get('host') || request.nextUrl.host;
  const publicBaseUrl = `${forwardedProto}://${host}`;

  console.log('[Slack/events] dispatching processSlackEvent', {
    eventId: payload.event_id,
    eventType: payload.event?.type,
    mode: installation.mode,
    publicBaseUrl,
  });
  after(() => runInContext(() => processSlackEvent(payload, installation, publicBaseUrl)));

  return NextResponse.json({ ok: true });
}
