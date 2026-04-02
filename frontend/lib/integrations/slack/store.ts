import 'server-only';
import { DocumentDB } from '@/lib/database/documents-db';
import { getConfigsByCompanyId, getRawConfigByCompanyId, saveConfigByCompanyId } from '@/lib/data/configs.server';
import { CompanyDB } from '@/lib/database/company-db';
import { resolvePath } from '@/lib/mode/path-resolver';
import { VALID_MODES, type Mode } from '@/lib/mode/mode-types';
import type { ConfigBot, ConfigContent, SlackBotConfig, SlackThreadContent } from '@/lib/types';

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
// Thread bindings — one DocumentDB file per Slack thread
//
// Path: /logs/slack/{teamId}/{channelId}-{sanitizedThreadTs}
// Type: 'slack_thread'
//
// Each thread is a first-class file: has an integer ID, proper path, and
// standard permissions. No monolithic runtime-state blob.
// ============================================================================

function sanitizeTs(ts: string): string {
  return ts.replace(/\./g, '-');
}

function threadFilePath(mode: Mode, teamId: string, channelId: string, threadTs: string): string {
  return resolvePath(mode, `/logs/slack/${teamId}/${channelId}-${sanitizeTs(threadTs)}`);
}

export async function getThreadConversationId(
  companyId: number,
  mode: Mode,
  teamId: string,
  channelId: string,
  threadTs: string,
): Promise<number | null> {
  const path = threadFilePath(mode, teamId, channelId, threadTs);
  const file = await DocumentDB.getByPath(path, companyId);
  if (!file) return null;
  return (file.content as SlackThreadContent).conversationId ?? null;
}

export async function setThreadConversationId(
  companyId: number,
  mode: Mode,
  teamId: string,
  channelId: string,
  threadTs: string,
  conversationId: number,
  participantEmail: string,
): Promise<void> {
  const path = threadFilePath(mode, teamId, channelId, threadTs);
  const now = new Date().toISOString();
  const existing = await DocumentDB.getByPath(path, companyId);

  if (existing) {
    const prev = existing.content as SlackThreadContent;
    const participants = [...new Set([...prev.participants, participantEmail])];
    await DocumentDB.update(
      existing.id,
      existing.name,
      path,
      { ...prev, conversationId, participants, messageCount: prev.messageCount + 1, updatedAt: now } as any,
      [],
      companyId,
    );
  } else {
    const name = `slack-${channelId}-${now.slice(0, 10)}`;
    const content: SlackThreadContent = {
      teamId,
      channelId,
      threadTs,
      conversationId,
      participants: [participantEmail],
      messageCount: 1,
      createdAt: now,
      updatedAt: now,
    };
    await DocumentDB.create(name, path, 'slack_thread', content as any, [], companyId);
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
    // Evict the oldest entry (insertion order)
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
