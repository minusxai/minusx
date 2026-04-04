import 'server-only';

/**
 * Builds the Block Kit welcome message sent when a user first opens the app DM.
 * Includes a greeting and suggestion buttons that feed back as regular messages.
 */
export function buildWelcomeBlocks(appName: string): { text: string; blocks: unknown[] } {
  const text = `Hi there! I'm ${appName} agent, your AI data analyst. Ask me anything about your data.`;

  const suggestions = [
    'Show me a few tables I have access to',
    "What're some dashboards I can look at?",
    'A 5 bullet summary of our Knowledge Base',
  ];

  const blocks: unknown[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Hi there! :wave: I'm *${appName}* agent, your AI data analyst.\nAsk me anything about your company's data.`,
      },
    },
    ...suggestions.map((label) => ({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: label, emoji: true },
          action_id: `welcome_suggestion:${label}`,
          value: label,
        },
      ],
    })),
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Or just type your own question below.',
        },
      ],
    },
  ];

  return { text, blocks };
}

/**
 * Builds the App Home tab view — a static help page shown when users click the Home tab.
 */
export function buildHomeView(appName: string, platformUrl: string = 'https://minusx.app'): unknown {
  const blocks: unknown[] = [
    {
      type: 'image',
      image_url: 'https://minusx.ai/logo_light.png',
      alt_text: `${appName} logo`,
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${appName}* is your AI data analyst. Ask questions in plain English and get answers backed by your company's data and context.`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':rocket: MinusX Platform', emoji: true },
          url: platformUrl,
          action_id: 'home_open_platform',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':book:  Documentation', emoji: true },
          url: 'https://docsv2.minusx.ai/docs',
          action_id: 'home_open_docs',
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'header',
      text: { type: 'plain_text', text: ':speech_balloon:  How to use', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '• *DM the bot* — Open a direct message with this app and ask anything.',
          '• *@mention in a channel* — Tag the bot in any channel to ask a question publicly.',
          '• *Thread replies* — Reply in a thread to continue the conversation with context.',
        ].join('\n'),
      },
    },
    { type: 'divider' },
    {
      type: 'header',
      text: { type: 'plain_text', text: ':bulb:  Example questions', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '• _What tables do I have access to?_',
          '• _Show me revenue by month for the last quarter_',
          '• _Help me write a SQL query to find churned users_',
        ].join('\n'),
      },
    },
    { type: 'divider' },
    {
      type: 'header',
      text: { type: 'plain_text', text: ':gear:  How it works', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '1. Your message is matched to your MinusX account by email.',
          '2. The agent uses your team\'s data connections and Knowledge Base context.',
          '3. It writes and runs SQL queries, then summarizes the results.',
          '4. :eyes: means the bot is working. :white_check_mark: means it\'s done. :x: means something went wrong.',
        ].join('\n'),
      },
    },
  ];

  return {
    type: 'home',
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Track which users have already been welcomed (in-memory, per-process).
// Keyed by `${teamId}:${userId}` — avoids sending the welcome on every DM open.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-restricted-syntax -- tracks welcomed user emails; cross-tenant sharing is intentional (idempotent welcome, not data access)
const welcomedUsers = new Set<string>();
const MAX_WELCOMED_SIZE = 2000;

export function shouldSendWelcome(teamId: string, userId: string): boolean {
  const key = `${teamId}:${userId}`;
  if (welcomedUsers.has(key)) return false;
  if (welcomedUsers.size >= MAX_WELCOMED_SIZE) {
    const first = welcomedUsers.values().next().value;
    if (first !== undefined) welcomedUsers.delete(first);
  }
  welcomedUsers.add(key);
  return true;
}
