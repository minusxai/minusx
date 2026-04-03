import 'server-only';
import { AUTH_URL, SLACK_SIGNING_SECRET as CONFIG_SLACK_SIGNING_SECRET } from '@/lib/config';

export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'chat:write',
  'groups:history',
  'im:history',
  'mpim:history',
  'reactions:write',
  'users:read',
  'users:read.email',
] as const;

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

  return AUTH_URL?.trim() || null;
}

export function getSlackSigningSecret(): string | null {
  return CONFIG_SLACK_SIGNING_SECRET?.trim() || null;
}

export function getSlackCapabilities(baseUrlOverride?: string | null) {
  const baseUrl = getSlackBaseUrl(baseUrlOverride);
  const hasPublicBaseUrl = isPublicSlackBaseUrl(baseUrl);

  return {
    selfHostedEnabled: hasPublicBaseUrl,
    baseUrl: hasPublicBaseUrl ? baseUrl : AUTH_URL,
  };
}

export function buildSlackManifest(appName: string, baseUrl: string = AUTH_URL, devSubdomain?: string) {
  const subdomainSuffix = devSubdomain ? `?subdomain=${encodeURIComponent(devSubdomain)}` : '';
  return {
    display_information: {
      name: appName,
      description: `Talk directly to ${appName} agent from Slack.`,
      long_description: `${appName} is an Agentic Business Intelligence platform built for native AI interop. Ask questions in plain English across all your data, use agents to dig through dashboards and questions, and get answers you can understand and trust.`,
      background_color: '#0D1117',
    },
    features: {
      app_home: {
        home_tab_enabled: true,
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
        request_url: `${baseUrl}/api/integrations/slack/events${subdomainSuffix}`,
        bot_events: ['app_mention', 'message.im', 'app_home_opened'],
      },
      interactivity: {
        is_enabled: true,
        request_url: `${baseUrl}/api/integrations/slack/interact${subdomainSuffix}`,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
