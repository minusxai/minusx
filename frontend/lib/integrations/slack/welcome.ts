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

// ---------------------------------------------------------------------------
// Track which users have already been welcomed (in-memory, per-process).
// Keyed by `${teamId}:${userId}` — avoids sending the welcome on every DM open.
// ---------------------------------------------------------------------------

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
