import 'server-only';
import { getConfigsForMode, getRawConfig, saveRawConfig } from '@/lib/data/configs.server';
import { resolveConfigSecrets } from '@/lib/secrets/config-secrets.server';
import { createConversation, findConversationIdByMeta } from '@/lib/data/conversations.server';
import { VALID_MODES, type Mode } from '@/lib/mode/mode-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConfigBot, ConfigChannel, ConfigContent, ConversationSource, SlackBotConfig } from '@/lib/types';

// ============================================================================
// Bot config CRUD — lives in /org/configs/config (org config file)
// ============================================================================

export interface SlackInstallationMatch {
  mode: Mode;
  bot: SlackBotConfig;
  config: ConfigContent;
}

function normalizeSlackBot(bot: SlackBotConfig): SlackBotConfig {
  return { ...bot, enabled: bot.enabled ?? true };
}

export async function upsertSlackBotConfig(
  mode: Mode,
  bot: SlackBotConfig,
): Promise<void> {
  const rawConfig = await getRawConfig(mode);
  const existing = (rawConfig.bots ?? []) as ConfigBot[];
  const normalized = normalizeSlackBot(bot);

  const next = [...existing];
  const idx = next.findIndex(
    (e): e is SlackBotConfig =>
      e.type === 'slack' &&
      ((!!normalized.team_id && e.team_id === normalized.team_id) || e.name === normalized.name),
  );
  if (idx >= 0) {
    next[idx] = normalized;
  } else {
    next.push(normalized);
  }

  await saveRawConfig(mode, { ...rawConfig, bots: next });
}

export async function removeSlackBotConfig(
  mode: Mode,
  teamId: string,
): Promise<void> {
  const rawConfig = await getRawConfig(mode);
  await saveRawConfig(mode, {
    ...rawConfig,
    bots: (rawConfig.bots ?? []).filter(b => !(b.type === 'slack' && b.team_id === teamId)),
  });
}

export async function rememberSlackAppChannel(
  mode: Mode,
  input: {
    teamId: string;
    channelId: string;
    teamName?: string;
    channelName?: string;
  },
): Promise<void> {
  const rawConfig = await getRawConfig(mode);
  const existing = (rawConfig.channels ?? []) as ConfigChannel[];
  const channelName = input.channelName?.trim();
  const displayName = channelName
    ? `#${channelName}`
    : `Slack ${input.teamName || input.teamId} ${input.channelId}`;

  const next = [...existing];
  const idx = next.findIndex(
    ch => ch.type === 'slack_app' &&
      ch.team_id === input.teamId &&
      ch.channel_id === input.channelId,
  );

  if (idx >= 0) {
    const current = next[idx];
    if (current.type === 'slack_app') {
      next[idx] = {
        ...current,
        team_name: input.teamName ?? current.team_name,
        channel_name: channelName ?? current.channel_name,
        name: current.name || displayName,
        captured_at: current.captured_at ?? new Date().toISOString(),
      };
    }
  } else {
    next.push({
      type: 'slack_app',
      name: displayName,
      team_id: input.teamId,
      team_name: input.teamName,
      channel_id: input.channelId,
      channel_name: channelName,
      captured_at: new Date().toISOString(),
    });
  }

  await saveRawConfig(mode, { ...rawConfig, channels: next });
}

async function findSlackBotByTeam(
  teamId: string,
): Promise<SlackInstallationMatch | null> {
  for (const mode of VALID_MODES) {
    const { config } = await getConfigsForMode(mode);
    const bot = (config.bots ?? []).find(
      (b): b is SlackBotConfig =>
        b.type === 'slack' && b.enabled !== false && b.team_id === teamId,
    );
    if (bot) {
      // Credentials are stored as @SECRETS/… refs — resolve to raw values for
      // the Slack API calls (server-only; legacy raw values pass through).
      return { mode, bot: await resolveConfigSecrets(bot), config: config as ConfigContent };
    }
  }
  return null;
}

export async function findSlackInstallationByTeam(
  teamId: string,
): Promise<SlackInstallationMatch | null> {
  return findSlackBotByTeam(teamId);
}

// ============================================================================
// Thread conversation — one v3 conversation per Slack thread.
//
// Idempotent lookup by `meta.slackThreadKey` (Slack threads have no surrogate id of their own).
// On first message a v3 conversation is created; follow-ups resolve to the same id, and the shared
// v3 turn runner (runConversationTurn, driven via runSlackChatTurn) appends to its `messages` rows.
// ============================================================================

function slackThreadKey(teamId: string, channelId: string, threadTs: string): string {
  return `slack:${teamId}:${channelId}:${threadTs}`;
}

export async function getOrCreateSlackConversationId(
  user: EffectiveUser,
  teamId: string,
  channelId: string,
  threadTs: string,
  userMessage?: string,
): Promise<number> {
  const threadKey = slackThreadKey(teamId, channelId, threadTs);
  const existing = await findConversationIdByMeta('slackThreadKey', threadKey);
  if (existing != null) return existing;

  const name = userMessage
    ? userMessage.trim().replace(/\s+/g, ' ').substring(0, 50)
    : `slack-${channelId}-${new Date().toISOString().slice(0, 10)}`;
  const source: ConversationSource = { type: 'slack', teamId, channelId, threadTs };
  const conv = await createConversation({
    ownerUserId: user.userId,
    mode: user.mode,
    agent: 'SlackAgent',
    title: name,
    meta: { slackThreadKey: threadKey, source, ...(userMessage ? { firstMessage: userMessage.trim() } : {}) },
  });
  return conv.id;
}

// ============================================================================
// Event deduplication — in-memory LRU set
//
// Best-effort: dedup is lost on process restart, not atomic across instances.
// Acceptable for single-instance deployments; Slack retries are infrequent.
// ============================================================================

// eslint-disable-next-line no-restricted-syntax -- Slack event IDs are globally unique (assigned by Slack), dedup is cross-org safe
const processedEventIds = new Set<string>();
const MAX_DEDUP_SIZE = 500;

/**
 * Attempt to reserve an event ID for processing.
 * Returns true if this process should handle the event, false if already seen.
 */
export function reserveSlackEvent(eventId: string): boolean {
  if (processedEventIds.has(eventId)) return false;
  if (processedEventIds.size >= MAX_DEDUP_SIZE) {
    const first = processedEventIds.values().next().value;
    if (first !== undefined) processedEventIds.delete(first);
  }
  processedEventIds.add(eventId);
  return true;
}

/** Mark event as done — no-op in in-memory design, kept for API compatibility. */
export function markSlackEventDone(_eventId: string): void {
  // No-op: the event is already in the set from reserveSlackEvent.
}
