import { validateCompanyConfig } from '@/lib/data/configs.server';
import { extractSlackReplyFromLog, normalizeSlackPrompt } from '@/lib/integrations/slack/messages';
import type { ConversationLogEntry } from '@/lib/types';

describe('Slack config validation', () => {
  it('accepts config with Slack bot entries', () => {
    expect(validateCompanyConfig({
      bots: [
        {
          type: 'slack',
          name: 'Workspace Bot',
          install_mode: 'manifest_manual',
          bot_token: 'xoxb-test-token',
          signing_secret: 'signing-secret',
          team_id: 'T123',
          enabled: true,
        },
        {
          type: 'slack',
          name: 'Self Hosted Bot',
          install_mode: 'manifest_manual',
          bot_token: 'xoxb-test-token',
          signing_secret: 'signing-secret',
          team_id: 'T456',
          enabled: true,
        },
      ],
    })).toBe(true);
  });
});

describe('Slack message helpers', () => {
  it('strips bot mentions from prompts', () => {
    expect(normalizeSlackPrompt('<@U123>   what changed this week?', 'U123')).toBe('what changed this week?');
  });

  it('extracts the visible assistant reply from conversation logs', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_result',
        _task_unique_id: 'task_1',
        created_at: new Date().toISOString(),
        result: {
          completed_tool_calls: [
            {
              function: { name: 'TalkToUser', arguments: {} },
              content: '<thinking>hidden</thinking><answer>Revenue is up 12% week over week.</answer>',
            },
          ],
        },
      },
    ];

    expect(extractSlackReplyFromLog(log)).toBe('Revenue is up 12% week over week.');
  });

  it('falls back to root task result content when no TalkToUser tool is present', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_result',
        _task_unique_id: 'task_2',
        created_at: new Date().toISOString(),
        result: {
          success: true,
          content: 'Sup from SlackAgent.',
        },
      },
    ];

    expect(extractSlackReplyFromLog(log)).toBe('Sup from SlackAgent.');
  });
});
