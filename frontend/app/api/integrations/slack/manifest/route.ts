import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { buildSlackManifest, getSlackCapabilities } from '@/lib/integrations/slack/config';
import { getConfigs } from '@/lib/data/configs.server';

export const GET = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage Slack bots');
  }

  const capabilities = getSlackCapabilities();
  if (!capabilities.selfHostedEnabled) {
    return ApiErrors.forbidden('Set AUTH_URL to a public HTTPS URL before generating the Slack manifest');
  }

  const { config } = await getConfigs(user);
  const appName = `${config.branding.agentName || 'MinusX'} Slack Bot`;
  const manifest = buildSlackManifest(appName);

  return new NextResponse(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'inline; filename="slack-manifest.json"',
    },
  });
});
