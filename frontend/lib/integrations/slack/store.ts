import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { getConfigsByCompanyId, getRawConfigByCompanyId, saveConfigByCompanyId } from '@/lib/data/configs.server';
import { CompanyDB } from '@/lib/database/company-db';
import { resolvePath } from '@/lib/mode/path-resolver';
import { VALID_MODES, type Mode } from '@/lib/mode/mode-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConfigBot, ConfigContent, ConversationFileContent, ConversationSource, SlackBotConfig } from '@/lib/types';

// ============================================================================
// Bot config CRUD — lives in /org/configs/config (per-company config file)
// ============================================================================

export interface SlackInstallationMatch {
  companyId: number;
  mode: Mode;
  bot: SlackBotConfig;
  config: ConfigContent;
}

function normalizeSlackBot(bot: SlackBotConfig): SlackBotConfig {
  return { ...bot, enabled: bot.enabled ?? true };
}

export async function upsertSlackBotConfig(
  companyId: number,
  mode: Mode,
  bot: SlackBotConfig,
): Promise<void> {
  const rawConfig = await getRawConfigByCompanyId(companyId, mode);
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

  await saveConfigByCompanyId(companyId, mode, { ...rawConfig, bots: next });
}

export async function removeSlackBotConfig(
  companyId: number,
  mode: Mode,
  teamId: string,
): Promise<void> {
  const rawConfig = await getRawConfigByCompanyId(companyId, mode);
  await saveConfigByCompanyId(companyId, mode, {
    ...rawConfig,
    bots: (rawConfig.bots ?? []).filter(b => !(b.type === 'slack' && b.team_id === teamId)),
  });
}

async function findSlackBotByTeamInCompany(
  companyId: number,
  teamId: string,
): Promise<SlackInstallationMatch | null> {
  for (const mode of VALID_MODES) {
    const { config } = await getConfigsByCompanyId(companyId, mode);
    const bot = (config.bots ?? []).find(
      (b): b is SlackBotConfig =>
        b.type === 'slack' && b.enabled !== false && b.team_id === teamId,
    );
    if (bot) {
      return { companyId, mode, bot, config: config as ConfigContent };
    }
  }
  return null;
}

export async function findSlackInstallationByTeam(
  teamId: string,
): Promise<SlackInstallationMatch | null> {
  const defaultCompany = await CompanyDB.getDefaultCompany();
  if (defaultCompany) {
    return findSlackBotByTeamInCompany(defaultCompany.id, teamId);
  }
  const companies = await CompanyDB.listAll();
  for (const company of companies) {
    const match = await findSlackBotByTeamInCompany(company.id, teamId);
    if (match) return match;
  }
  return null;
}

// ============================================================================
// Thread conversation — one conversation file per Slack thread
//
// Path: /logs/slack/{teamId}/{channelId}-{sanitizedThreadTs}
// Type: 'conversation'
//
// On first message the file is pre-created (empty log), so runChatOrchestration
// always receives a real conversationId and appends to the same file on follow-ups.
// ============================================================================

function sanitizeTs(ts: string): string {
  return ts.replace(/\./g, '-');
}

function threadFilePath(mode: Mode, teamId: string, channelId: string, threadTs: string): string {
  return resolvePath(mode, `/logs/slack/${teamId}/${channelId}-${sanitizeTs(threadTs)}`);
}

export async function getOrCreateSlackConversationId(
  user: EffectiveUser,
  teamId: string,
  channelId: string,
  threadTs: string,
  channelName?: string,
): Promise<number> {
  const path = threadFilePath(user.mode, teamId, channelId, threadTs);
  try {
    const result = await FilesAPI.loadFileByPath(path, user);
    return result.data.id;
  } catch {
    // First message in this thread — create an empty conversation file at the Slack path
    const now = new Date().toISOString();
    const userId = user.userId?.toString() || user.email;
    const name = `slack-${channelId}-${now.slice(0, 10)}`;
    const source: ConversationSource = { type: 'slack', teamId, channelId, threadTs, ...(channelName && { channelName }) };
    const initialContent: ConversationFileContent = {
      metadata: { userId, name, createdAt: now, updatedAt: now, logLength: 0, source },
      log: [],
    };
    const result = await FilesAPI.createFile(
      { name, path, type: 'conversation', content: initialContent as any, options: { createPath: true } },
      user,
    );
    return result.data.id;
  }
}

// ============================================================================
// Event deduplication — in-memory LRU set
//
// Best-effort: dedup is lost on process restart, not atomic across instances.
// Acceptable for single-instance deployments; Slack retries are infrequent.
// ============================================================================

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
