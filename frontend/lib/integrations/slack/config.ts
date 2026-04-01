import 'server-only';
import { AUTH_URL } from '@/lib/constants';

export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'chat:write',
  'groups:history',
  'im:history',
  'mpim:history',
  'users:read',
  'users:read.email',
] as const;

function getConfiguredAuthUrl(): string | null {
  return process.env.AUTH_URL?.trim() || null;
}

export function isPublicSlackBaseUrl(url: string | null): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '0.0.0.0';
  } catch {
    return false;
  }
}

export function getSlackBaseUrl(baseUrlOverride?: string | null): string | null {
  const override = baseUrlOverride?.trim() || null;
  if (override) {
    return override;
  }

  return getConfiguredAuthUrl();
}

export function getSlackSigningSecret(): string | null {
  return process.env.SLACK_SIGNING_SECRET?.trim() || null;
}

export function getSlackCapabilities(baseUrlOverride?: string | null) {
  const baseUrl = getSlackBaseUrl(baseUrlOverride);
  const hasPublicBaseUrl = isPublicSlackBaseUrl(baseUrl);

  return {
    selfHostedEnabled: hasPublicBaseUrl,
    baseUrl: hasPublicBaseUrl ? baseUrl : AUTH_URL,
  };
}

export function buildSlackManifest(appName: string, baseUrl: string = AUTH_URL) {
  return {
    display_information: {
      name: appName,
      description: 'Talk directly to the MinusX agent from Slack.',
      background_color: '#0f172a',
    },
    features: {
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: {
        display_name: appName,
        always_online: false,
      },
    },
    oauth_config: {
      scopes: {
        bot: [...SLACK_BOT_SCOPES],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: `${baseUrl}/api/integrations/slack/events`,
        bot_events: ['app_mention', 'message.im'],
      },
      interactivity: {
        is_enabled: false,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
