import { after, NextRequest, NextResponse } from 'next/server';
import { postSlackMessage, verifySlackRequestSignature } from '@/lib/integrations/slack/api';
import { getSlackSigningSecret } from '@/lib/integrations/slack/config';
import { findSlackInstallationByTeam } from '@/lib/integrations/slack/store';
import { processSlackEvent, type SlackEventEnvelope } from '../events/route';

export const runtime = 'nodejs';

interface SlackInteractionPayload {
  type: 'block_actions';
  trigger_id: string;
  user: { id: string; team_id?: string };
  team?: { id: string };
  channel?: { id: string };
  message?: { ts: string };
  actions?: Array<{
    action_id: string;
    value?: string;
    type: string;
  }>;
}

/**
 * Handles Slack interactivity payloads (button clicks from welcome message).
 * Converts button clicks into synthetic message events and processes them
 * through the existing orchestration pipeline.
 */
export async function POST(request: NextRequest) {
  console.log('[Slack interact] Received interactivity payload');

  // Read raw body first for signature verification, then parse form data from it.
  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get('payload');
  if (!payloadStr) {
    console.log('[Slack interact] No payload field in form data');
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadStr) as SlackInteractionPayload;
  } catch {
    console.log('[Slack interact] Failed to parse payload JSON');
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  console.log('[Slack interact] type=%s team=%s actions=%d', payload.type, payload.team?.id, payload.actions?.length ?? 0);

  const teamId = payload.team?.id ?? payload.user?.team_id;
  if (!teamId) {
    console.log('[Slack interact] No team ID found');
    return NextResponse.json({ ok: true });
  }

  const installation = await findSlackInstallationByTeam(teamId);
  if (!installation) {
    console.log('[Slack interact] No installation found for team %s', teamId);
    return NextResponse.json({ ok: true });
  }

  const signingSecret = installation.bot.signing_secret ?? getSlackSigningSecret();
  if (signingSecret) {
    const isValid = verifySlackRequestSignature({
      rawBody,
      timestamp: request.headers.get('x-slack-request-timestamp'),
      signature: request.headers.get('x-slack-signature'),
      signingSecret,
    });
    if (!isValid) {
      console.log('[Slack interact] Signature verification failed');
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  if (payload.type !== 'block_actions') {
    console.log('[Slack interact] Ignoring non-block_actions type: %s', payload.type);
    return NextResponse.json({ ok: true });
  }

  const action = payload.actions?.[0];
  if (!action?.value) {
    console.log('[Slack interact] No action value found');
    return NextResponse.json({ ok: true });
  }

  console.log('[Slack interact] Processing action: %s', action.value);

  const channel = payload.channel?.id ?? payload.user.id;

  // Ack immediately with a "working on it" message, then thread the answer under it
  after(async () => {
    const ack = await postSlackMessage(installation.bot.bot_token, {
      channel,
      text: `:mag: Working on: _${action.value}_`,
    });

    // Build a synthetic message event with thread_ts so the reply threads under the ack
    const syntheticEnvelope: SlackEventEnvelope = {
      type: 'event_callback',
      team_id: teamId,
      event: {
        type: 'message',
        user: payload.user.id,
        text: action.value,
        channel,
        channel_type: 'im',
        thread_ts: ack.ts,
        ts: ack.ts,
      },
    };

    await processSlackEvent(syntheticEnvelope, installation);
  });

  return NextResponse.json({ ok: true });
}
