import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { ApiErrors, handleApiError, successResponse } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { postSlackMessage } from '@/lib/integrations/slack/api';
import type { SlackBotConfig } from '@/lib/types';

interface TestMessageRequest {
  teamId?: string;
  channelId?: string;
  text?: string;
}

export const POST = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can test Slack delivery');
  }

  let body: TestMessageRequest;
  try {
    body = await request.json() as TestMessageRequest;
  } catch {
    return ApiErrors.validationError('Invalid request body');
  }

  const teamId = body.teamId?.trim();
  const channelId = body.channelId?.trim();
  if (!teamId || !channelId) {
    return ApiErrors.validationError('teamId and channelId are required');
  }

  try {
    const { config } = await getConfigsForMode(user.mode);
    const channel = (config.channels ?? []).find(
      ch => ch.type === 'slack_app' &&
        ch.team_id === teamId &&
        ch.channel_id === channelId,
    );
    if (!channel || channel.type !== 'slack_app') {
      return ApiErrors.notFound('Captured Slack channel');
    }

    const bot = (config.bots ?? []).find(
      (candidate): candidate is SlackBotConfig =>
        candidate.type === 'slack' &&
        candidate.enabled !== false &&
        candidate.team_id === teamId,
    );
    if (!bot) {
      return ApiErrors.notFound('Slack app installation');
    }

    const appName = config.branding.agentName || 'MinusX';
    const text = body.text?.trim() ||
      `:white_check_mark: Test message from ${appName} to ${channel.name}.`;
    const result = await postSlackMessage(bot.bot_token, {
      channel: channel.channel_id,
      text,
    });

    return successResponse({
      ok: true,
      ts: result.ts,
      channel: {
        name: channel.name,
        team_id: channel.team_id,
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
});
