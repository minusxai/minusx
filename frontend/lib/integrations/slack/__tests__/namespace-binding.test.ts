/**
 * A Slack event webhook arrives with no session and no workspace-identifying host —
 * only a `team_id`. Resolving that to a namespace has to happen before any request
 * context exists, so it cannot read namespace-scoped storage. Install time is the one
 * moment both the team id and the namespace are known, so the bot upsert must record
 * the binding (and the removal must forget it).
 */

import { getModules } from '@/lib/modules/registry';
import { upsertSlackBotConfig, removeSlackBotConfig } from '@/lib/integrations/slack/store';
import { getRawConfig, saveRawConfig } from '@/lib/data/configs.server';
import type { SlackBotConfig } from '@/lib/types';

vi.mock('@/lib/data/configs.server', () => ({
  getRawConfig: vi.fn(),
  saveRawConfig: vi.fn(),
  getConfigsForMode: vi.fn(),
}));

function slackBot(overrides: Partial<SlackBotConfig> = {}): SlackBotConfig {
  return {
    type: 'slack',
    name: 'Acme',
    install_mode: 'oauth',
    bot_token: 'xoxb-test',
    team_id: 'T0ACME',
    enabled: true,
    ...overrides,
  } as SlackBotConfig;
}

describe('Slack install → namespace binding', () => {
  beforeEach(() => {
    vi.mocked(getRawConfig).mockResolvedValue({});
    vi.mocked(saveRawConfig).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds the team id to the current namespace when a bot is installed', async () => {
    const bind = vi.spyOn(getModules().namespace, 'bindExternalId');

    await upsertSlackBotConfig('org', slackBot());

    expect(bind).toHaveBeenCalledWith('slack_team', 'T0ACME');
  });

  it('binds on re-install of an existing bot, so a re-authorised team stays resolvable', async () => {
    vi.mocked(getRawConfig).mockResolvedValue({ bots: [slackBot()] } as never);
    const bind = vi.spyOn(getModules().namespace, 'bindExternalId');

    await upsertSlackBotConfig('org', slackBot({ bot_token: 'xoxb-rotated' }));

    expect(bind).toHaveBeenCalledWith('slack_team', 'T0ACME');
  });

  it('does not bind when the bot carries no team id', async () => {
    const bind = vi.spyOn(getModules().namespace, 'bindExternalId');

    await upsertSlackBotConfig('org', slackBot({ team_id: undefined }));

    expect(bind).not.toHaveBeenCalled();
  });

  it('unbinds the team id when the bot is removed', async () => {
    vi.mocked(getRawConfig).mockResolvedValue({ bots: [slackBot()] } as never);
    const unbind = vi.spyOn(getModules().namespace, 'unbindExternalId');

    await removeSlackBotConfig('org', 'T0ACME');

    expect(unbind).toHaveBeenCalledWith('slack_team', 'T0ACME');
  });

  it('never lets a binding failure break the install — the config write is what matters', async () => {
    vi.spyOn(getModules().namespace, 'bindExternalId').mockRejectedValue(new Error('bind exploded'));

    await expect(upsertSlackBotConfig('org', slackBot())).resolves.toBeUndefined();
    expect(saveRawConfig).toHaveBeenCalled();
  });
});
