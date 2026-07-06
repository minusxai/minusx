import { after, NextRequest, NextResponse } from 'next/server';
import { postSlackMessage, verifySlackRequestSignature } from '@/lib/integrations/slack/api';
import { getSlackSigningSecret } from '@/lib/integrations/slack/config';
import { findSlackInstallationByTeam } from '@/lib/integrations/slack/store';
import { resolveThreadTs, type SlackInteractionPayload } from '@/lib/integrations/slack/interactions';
import { processSlackEvent, type SlackEventEnvelope } from '@/lib/integrations/slack/process-event';

export const runtime = 'nodejs';

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
  // Continue in the thread the button lives in (falls back to the message itself
  // when it's a root message, e.g. the welcome message).
  const parentThreadTs = resolveThreadTs(payload);

  after(async () => {
    // Ack into the existing thread so the conversation stays in place.
    const ack = await postSlackMessage(installation.bot.bot_token, {
      channel,
      text: `:mag: Working on: _${action.value}_`,
      thread_ts: parentThreadTs,
    });

    const threadTs = parentThreadTs ?? ack.ts;

    // Build a synthetic message event in that thread so the reply threads correctly.
    const syntheticEnvelope: SlackEventEnvelope = {
      type: 'event_callback',
      team_id: teamId,
      event: {
        type: 'message',
        user: payload.user.id,
        text: action.value,
        channel,
        channel_type: 'im',
        thread_ts: threadTs,
        ts: ack.ts,
      },
    };

    await processSlackEvent(syntheticEnvelope, installation);
  });

  return NextResponse.json({ ok: true });
}
