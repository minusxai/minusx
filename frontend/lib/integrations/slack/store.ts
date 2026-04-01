import 'server-only';
import { DocumentDB } from '@/lib/database/documents-db';
import { getConfigsByCompanyId, getRawConfigByCompanyId, saveConfigByCompanyId } from '@/lib/data/configs.server';
import { CompanyDB } from '@/lib/database/company-db';
import { resolvePath } from '@/lib/mode/path-resolver';
import { VALID_MODES, type Mode } from '@/lib/mode/mode-types';
import type { ConfigBot, ConfigContent, SlackBotConfig, BaseFileContent } from '@/lib/types';

const RUNTIME_STATE_NAME = 'slack-runtime-state.json';

interface SlackThreadBinding {
  conversationId: number;
  updatedAt: string;
}

interface SlackProcessedEvent {
  status: 'processing' | 'completed' | 'failed';
  updatedAt: string;
}

interface SlackRuntimeStateContent extends BaseFileContent {
  threads: Record<string, SlackThreadBinding>;
  processedEvents: Record<string, SlackProcessedEvent>;
}

export interface SlackInstallationMatch {
  companyId: number;
  mode: Mode;
  bot: SlackBotConfig;
  config: ConfigContent;
}

const DEFAULT_RUNTIME_STATE: SlackRuntimeStateContent = {
  threads: {},
  processedEvents: {},
};

function getRuntimeStatePath(mode: Mode): string {
  return resolvePath(mode, '/configs/slack-runtime-state');
}

function threadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

function eventKey(eventId: string): string {
  return eventId;
}

function pruneRecord<T extends { updatedAt: string }>(record: Record<string, T>, maxItems: number): Record<string, T> {
  const entries = Object.entries(record);
  if (entries.length <= maxItems) {
    return record;
  }

  return Object.fromEntries(
    entries
      .sort((a, b) => new Date(b[1].updatedAt).getTime() - new Date(a[1].updatedAt).getTime())
      .slice(0, maxItems)
  );
}

async function loadRuntimeState(companyId: number, mode: Mode): Promise<{ fileId: number | null; content: SlackRuntimeStateContent }> {
  const path = getRuntimeStatePath(mode);
  const existing = await DocumentDB.getByPath(path, companyId);
  if (!existing) {
    return { fileId: null, content: DEFAULT_RUNTIME_STATE };
  }

  const content = (existing.content as SlackRuntimeStateContent | null) ?? DEFAULT_RUNTIME_STATE;
  return {
    fileId: existing.id,
    content: {
      threads: content.threads ?? {},
      processedEvents: content.processedEvents ?? {},
    },
  };
}

async function saveRuntimeState(companyId: number, mode: Mode, fileId: number | null, content: SlackRuntimeStateContent): Promise<void> {
  const path = getRuntimeStatePath(mode);
  const normalized: SlackRuntimeStateContent = {
    threads: pruneRecord(content.threads, 1000),
    processedEvents: pruneRecord(content.processedEvents, 500),
  };

  if (fileId) {
    await DocumentDB.update(fileId, RUNTIME_STATE_NAME, path, normalized as any, [], companyId);
    return;
  }

  await DocumentDB.create(RUNTIME_STATE_NAME, path, 'config', normalized as any, [], companyId);
}

function normalizeSlackBot(bot: SlackBotConfig): SlackBotConfig {
  return {
    ...bot,
    enabled: bot.enabled ?? true,
  };
}

async function findSlackBotByTeamInCompany(companyId: number, teamId: string): Promise<SlackInstallationMatch | null> {
  for (const mode of VALID_MODES) {
    const { config } = await getConfigsByCompanyId(companyId, mode);
    const bot = (config.bots ?? []).find(
      (candidate): candidate is SlackBotConfig =>
        candidate.type === 'slack' &&
        candidate.enabled !== false &&
        candidate.team_id === teamId
    );

    if (bot) {
      return {
        companyId,
        mode,
        bot,
        config: config as ConfigContent,
      };
    }
  }

  return null;
}

export async function upsertSlackBotConfig(
  companyId: number,
  mode: Mode,
  bot: SlackBotConfig,
): Promise<void> {
  const rawConfig = await getRawConfigByCompanyId(companyId, mode);
  const existingBots = (rawConfig.bots ?? []) as ConfigBot[];
  const normalized = normalizeSlackBot(bot);

  const nextBots = [...existingBots];
  const index = nextBots.findIndex((entry) =>
    entry.type === 'slack' &&
    ((normalized.team_id && entry.team_id === normalized.team_id) || entry.name === normalized.name)
  );

  if (index >= 0) {
    nextBots[index] = normalized;
  } else {
    nextBots.push(normalized);
  }

  await saveConfigByCompanyId(companyId, mode, {
    ...rawConfig,
    bots: nextBots,
  });
}

export async function removeSlackBotConfig(
  companyId: number,
  mode: Mode,
  teamId: string,
): Promise<void> {
  const rawConfig = await getRawConfigByCompanyId(companyId, mode);
  await saveConfigByCompanyId(companyId, mode, {
    ...rawConfig,
    bots: (rawConfig.bots ?? []).filter((bot) => !(bot.type === 'slack' && bot.team_id === teamId)),
  });
}

export async function findSlackInstallationByTeam(teamId: string): Promise<SlackInstallationMatch | null> {
  const defaultCompany = await CompanyDB.getDefaultCompany();
  if (defaultCompany) {
    return findSlackBotByTeamInCompany(defaultCompany.id, teamId);
  }

  const companies = await CompanyDB.listAll();
  for (const company of companies) {
    const installation = await findSlackBotByTeamInCompany(company.id, teamId);
    if (installation) {
      return installation;
    }
  }

  return null;
}

export async function getThreadConversationId(
  companyId: number,
  mode: Mode,
  channelId: string,
  threadTs: string,
): Promise<number | null> {
  const { content } = await loadRuntimeState(companyId, mode);
  return content.threads[threadKey(channelId, threadTs)]?.conversationId ?? null;
}

export async function setThreadConversationId(
  companyId: number,
  mode: Mode,
  channelId: string,
  threadTs: string,
  conversationId: number,
): Promise<void> {
  const state = await loadRuntimeState(companyId, mode);
  state.content.threads[threadKey(channelId, threadTs)] = {
    conversationId,
    updatedAt: new Date().toISOString(),
  };
  await saveRuntimeState(companyId, mode, state.fileId, state.content);
}

export async function reserveSlackEvent(
  companyId: number,
  mode: Mode,
  slackEventId: string,
): Promise<boolean> {
  // This is best-effort dedup only. It is not atomic across concurrent requests or multi-instance deployments.
  const state = await loadRuntimeState(companyId, mode);
  const key = eventKey(slackEventId);
  if (state.content.processedEvents[key]) {
    return false;
  }

  state.content.processedEvents[key] = {
    status: 'processing',
    updatedAt: new Date().toISOString(),
  };
  await saveRuntimeState(companyId, mode, state.fileId, state.content);
  return true;
}

export async function markSlackEventStatus(
  companyId: number,
  mode: Mode,
  slackEventId: string,
  status: 'completed' | 'failed',
): Promise<void> {
  const state = await loadRuntimeState(companyId, mode);
  state.content.processedEvents[eventKey(slackEventId)] = {
    status,
    updatedAt: new Date().toISOString(),
  };
  await saveRuntimeState(companyId, mode, state.fileId, state.content);
}
