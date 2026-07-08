import { deliverMessages } from '@/lib/jobs/deliver-messages';
import { postSlackMessage } from '@/lib/integrations/slack/api';
import type { OrgConfig } from '@/lib/branding/whitelabel';
import type { RunMessageRecord } from '@/lib/types';

vi.mock('@/lib/integrations/slack/api', () => ({
  postSlackMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1700000000.000001' }),
}));

const postSlackMessageMock = vi.mocked(postSlackMessage);

function baseConfig(overrides: Partial<OrgConfig> = {}): OrgConfig {
  return {
    branding: { displayName: 'Test', agentName: 'Agent', favicon: '/favicon.ico' },
    links: { docsUrl: '', supportUrl: '', githubIssuesUrl: '', termsUrl: '' },
    ...overrides,
  };
}

function slackAppMessage(overrides: Partial<RunMessageRecord> = {}): RunMessageRecord {
  return {
    type: 'slack_app_alert',
    content: '*Daily digest*\nEverything looks good.',
    metadata: { channel: 'C_SALES', team_id: 'T_TEST', channel_name: 'sales' },
    status: 'pending',
    ...overrides,
  } as RunMessageRecord;
}

describe('deliverMessages slack_app_alert', () => {
  beforeEach(() => {
    postSlackMessageMock.mockClear();
  });

  it('sends through the matching installed Slack bot', async () => {
    const messages = [slackAppMessage()];
    const config = baseConfig({
      bots: [{
        type: 'slack',
        name: 'Slack',
        install_mode: 'oauth',
        bot_token: 'xoxb-test',
        team_id: 'T_TEST',
      }],
    });

    await deliverMessages(messages, config);

    expect(postSlackMessageMock).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C_SALES',
      text: '*Daily digest*\nEverything looks good.',
    });
    expect(messages[0]).toMatchObject({ status: 'sent' });
    expect(messages[0].sentAt).toBeTruthy();
    expect(messages[0].logs?.[0]).toMatchObject({ success: true });
  });

  it('fails clearly when no matching Slack app installation exists', async () => {
    const messages = [slackAppMessage()];

    await deliverMessages(messages, baseConfig({ bots: [] }));

    expect(postSlackMessageMock).not.toHaveBeenCalled();
    expect(messages[0]).toMatchObject({
      status: 'failed',
      deliveryError: 'No Slack app installation found for team T_TEST',
    });
  });
});
