import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors, handleApiError, successResponse } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getSlackCapabilities, SLACK_BOT_SCOPES } from '@/lib/integrations/slack/config';
import { slackAuthTest } from '@/lib/integrations/slack/api';
import { upsertSlackBotConfig } from '@/lib/integrations/slack/store';
import type { SlackBotConfig } from '@/lib/types';

interface ManualInstallRequest {
  botToken?: string;
  signingSecret?: string;
  name?: string;
}

export const POST = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage Slack bots');
  }

  const capabilities = getSlackCapabilities();
  if (!capabilities.selfHostedEnabled) {
    return ApiErrors.forbidden('Set AUTH_URL to a public HTTPS URL before configuring Slack');
  }

  try {
    const body = await request.json() as ManualInstallRequest;
    const botToken = body.botToken?.trim();
    const signingSecret = body.signingSecret?.trim();

    if (!botToken) {
      return ApiErrors.validationError('botToken is required');
    }

    if (!signingSecret) {
      return ApiErrors.validationError('signingSecret is required');
    }

    const authTest = await slackAuthTest(botToken);

    const bot: SlackBotConfig = {
      type: 'slack',
      name: body.name?.trim() || authTest.team || 'Slack',
      install_mode: 'manifest_manual',
      bot_token: botToken,
      signing_secret: signingSecret,
      team_id: authTest.team_id,
      team_name: authTest.team,
      bot_user_id: authTest.user_id,
      installed_at: new Date().toISOString(),
      installed_by: user.email,
      enabled: true,
      scopes: [...SLACK_BOT_SCOPES],
    };

    await upsertSlackBotConfig(user.companyId, user.mode, bot);

    return successResponse({ bot });
  } catch (error) {
    return handleApiError(error);
  }
});
