// End-to-end: config secrets never persist raw in the config DOCUMENT on any
// write path (POST /api/configs, saveRawConfig, FilesAPI.saveFile) and never
// reach a client-facing read path raw (GET /api/configs, FilesAPI.loadFile).
// Server consumers recover raw values via resolveConfigSecrets.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { SecretsDB } from '../secrets-db.server';
import { resolveConfigSecrets } from '../config-secrets.server';
import { isSecretRef, REDACTED_SECRET } from '../config-secret-specs';
import { saveRawConfig, getRawConfig } from '@/lib/data/configs.server';
import { loadFileByPath, saveFile } from '@/lib/data/files.server';
import { findSlackInstallationByTeam } from '@/lib/integrations/slack/store';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConfigContent, SlackBotConfig } from '@/lib/types';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}));

import { GET as configGet, POST as configPost } from '@/app/api/configs/route';

const user: EffectiveUser = {
  userId: 1, email: 't@e.com', name: 'T', role: 'admin', home_folder: '/org', mode: 'org',
};

const VALID_BRANDING = {
  logoLight: '/logo.svg', logoDark: '/logo-dark.svg',
  displayName: 'Test Co', agentName: 'TestBot', favicon: '/favicon.ico',
};

function slackBot(over: Partial<SlackBotConfig> = {}): SlackBotConfig {
  return {
    type: 'slack', name: 'main-bot', install_mode: 'manifest_manual',
    bot_token: 'xoxb-raw-secret-token', signing_secret: 'raw-signing-secret',
    team_id: 'T0001', enabled: true, ...over,
  };
}

async function postConfig(body: object) {
  return configPost(new NextRequest('http://localhost:3000/api/configs', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }));
}

async function getConfig() {
  return configGet(new NextRequest('http://localhost:3000/api/configs', { method: 'GET' }));
}

const dbPath = getTestDbPath('config_secrets_e2e');
beforeAll(async () => { await initTestDatabase(dbPath); });
afterAll(async () => { await cleanupTestDatabase(dbPath); });

describe('POST /api/configs → secrets boundary', () => {
  it('persists refs in the document; raw values live only in the secrets table; GET returns refs', async () => {
    const res = await postConfig({ branding: VALID_BRANDING, bots: [slackBot()] });
    expect(res.status).toBe(200);

    // The DOCUMENT never contains the raw values.
    const raw = await getRawConfig('org');
    const bot = (raw.bots ?? [])[0] as SlackBotConfig;
    expect(isSecretRef(bot.bot_token)).toBe(true);
    expect(isSecretRef(bot.signing_secret)).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('xoxb-raw-secret-token');
    expect(JSON.stringify(raw)).not.toContain('raw-signing-secret');

    // Raw values live only in the server-only secrets table.
    expect(await SecretsDB.get(bot.bot_token)).toBe('xoxb-raw-secret-token');
    expect(await SecretsDB.get(bot.signing_secret as string)).toBe('raw-signing-secret');

    // Client-facing GET carries the refs (safe), never the raw values.
    const getBody = await (await getConfig()).json();
    const gotBot = getBody.data.config.bots[0] as SlackBotConfig;
    expect(isSecretRef(gotBot.bot_token)).toBe(true);
    expect(JSON.stringify(getBody)).not.toContain('xoxb-raw-secret-token');

    // POST response echoes the saved config — also refs only.
    const postBody = await res.json();
    expect(JSON.stringify(postBody)).not.toContain('xoxb-raw-secret-token');
  });

  it('an unchanged ref round-trips: re-POSTing the config keeps the same secret', async () => {
    const before = await getRawConfig('org');
    await postConfig({ branding: VALID_BRANDING, bots: before.bots });
    const after = await getRawConfig('org');
    const bot = (after.bots ?? [])[0] as SlackBotConfig;
    expect(bot.bot_token).toBe((before.bots![0] as SlackBotConfig).bot_token);
    expect(await SecretsDB.get(bot.bot_token)).toBe('xoxb-raw-secret-token');
  });

  it('a new raw value replaces the secret; the ref stays identity-stable', async () => {
    const before = await getRawConfig('org');
    const bots = [{ ...(before.bots![0] as SlackBotConfig), bot_token: 'xoxb-rotated-token' }];
    await postConfig({ branding: VALID_BRANDING, bots });
    const after = await getRawConfig('org');
    const bot = (after.bots ?? [])[0] as SlackBotConfig;
    expect(isSecretRef(bot.bot_token)).toBe(true);
    expect(await SecretsDB.get(bot.bot_token)).toBe('xoxb-rotated-token');
  });
});

describe('llm section round-trip', () => {
  it('POSTed llm providers come back from GET with ref keys (mergeConfig must not drop llm)', async () => {
    const res = await postConfig({
      branding: VALID_BRANDING,
      llm: {
        providers: [{ name: 'rt-anthropic', provider: 'anthropic', apiKey: 'sk-ant-roundtrip' }],
        grades: { core: { providerName: 'rt-anthropic', model: 'claude-sonnet-4-6' } },
      },
    });
    expect(res.status).toBe(200);

    const getBody = await (await getConfig()).json();
    const llm = getBody.data.config.llm;
    expect(llm).toBeTruthy();
    expect(llm.providers[0].name).toBe('rt-anthropic');
    expect(isSecretRef(llm.providers[0].apiKey)).toBe(true);
    expect(llm.grades.core.model).toBe('claude-sonnet-4-6');
    expect(JSON.stringify(getBody)).not.toContain('sk-ant-roundtrip');
  });
});

describe('saveRawConfig (server write path, e.g. Slack install)', () => {
  it('extracts raw secrets to refs', async () => {
    await saveRawConfig('org', {
      bots: [slackBot({ name: 'installed-bot', team_id: 'T0002', bot_token: 'xoxb-installed' })],
    });
    const raw = await getRawConfig('org');
    const bot = (raw.bots ?? []).find(b => (b as SlackBotConfig).team_id === 'T0002') as SlackBotConfig;
    expect(isSecretRef(bot.bot_token)).toBe(true);
    expect(await SecretsDB.get(bot.bot_token)).toBe('xoxb-installed');
  });

  it('slack consumers get the RESOLVED token via findSlackInstallationByTeam', async () => {
    const match = await findSlackInstallationByTeam('T0002');
    expect(match).not.toBeNull();
    expect(match!.bot.bot_token).toBe('xoxb-installed');
  });
});

describe('FilesAPI (config.json page) read/write path', () => {
  it('saveFile extracts raw secrets; loadFile shows refs, never raw values', async () => {
    const configDoc = await DocumentDB.getByPath('/org/configs/config');
    expect(configDoc).not.toBeNull();

    const content = {
      ...(configDoc!.content as ConfigContent),
      bots: [slackBot({ name: 'page-bot', team_id: 'T0003', bot_token: 'xoxb-from-page' })],
    };
    await saveFile(configDoc!.id, configDoc!.name, configDoc!.path, content, [], user);

    const stored = await DocumentDB.getById(configDoc!.id);
    const bot = ((stored!.content as ConfigContent).bots ?? [])[0] as SlackBotConfig;
    expect(isSecretRef(bot.bot_token)).toBe(true);
    expect(await SecretsDB.get(bot.bot_token)).toBe('xoxb-from-page');

    const loaded = await loadFileByPath('/org/configs/config', user);
    expect(JSON.stringify(loaded.data.content)).not.toContain('xoxb-from-page');
  });

  it('a round-tripped redacted placeholder is restored, not persisted', async () => {
    const configDoc = await DocumentDB.getByPath('/org/configs/config');
    const before = (configDoc!.content as ConfigContent);
    const refBefore = (before.bots![0] as SlackBotConfig).bot_token;

    const edited = {
      ...before,
      bots: [{ ...(before.bots![0] as SlackBotConfig), bot_token: REDACTED_SECRET }],
    };
    await saveFile(configDoc!.id, configDoc!.name, configDoc!.path, edited, [], user);

    const stored = await DocumentDB.getById(configDoc!.id);
    const bot = ((stored!.content as ConfigContent).bots ?? [])[0] as SlackBotConfig;
    expect(bot.bot_token).toBe(refBefore);
    expect(JSON.stringify(stored!.content)).not.toContain(REDACTED_SECRET);
  });

  it('deleting the key deletes the credential from the document', async () => {
    const configDoc = await DocumentDB.getByPath('/org/configs/config');
    const before = (configDoc!.content as ConfigContent);
    const { bot_token: _gone, ...botWithoutToken } = before.bots![0] as SlackBotConfig;
    await saveFile(configDoc!.id, configDoc!.name, configDoc!.path, { ...before, bots: [botWithoutToken] } as ConfigContent, [], user);

    const stored = await DocumentDB.getById(configDoc!.id);
    const bot = ((stored!.content as ConfigContent).bots ?? [])[0] as SlackBotConfig;
    expect(bot.bot_token).toBeUndefined();
  });

  it('legacy raw values (pre-extraction docs) are masked on load', async () => {
    // Simulate a legacy doc written before extraction existed.
    const configDoc = await DocumentDB.getByPath('/org/configs/config');
    const legacy = {
      ...(configDoc!.content as ConfigContent),
      bots: [slackBot({ name: 'legacy-bot', bot_token: 'xoxb-legacy-raw' })],
    };
    await DocumentDB.update(configDoc!.id, configDoc!.name, configDoc!.path, legacy as never, [], 'legacy-hash');

    const loaded = await loadFileByPath('/org/configs/config', user);
    const bot = ((loaded.data.content as ConfigContent).bots ?? [])[0] as SlackBotConfig;
    expect(bot.bot_token).toBe(REDACTED_SECRET);
    expect(JSON.stringify(loaded.data.content)).not.toContain('xoxb-legacy-raw');

    // GET /api/configs is masked too.
    const getBody = await (await getConfig()).json();
    expect(JSON.stringify(getBody)).not.toContain('xoxb-legacy-raw');
  });
});

describe('resolveConfigSecrets', () => {
  it('deep-resolves refs anywhere in a value; unknown refs and raw values pass through', async () => {
    await SecretsDB.set('@SECRETS/config/org/bots/x/bot_token', 'raw-x');
    const resolved = await resolveConfigSecrets({
      nested: { arr: [{ token: '@SECRETS/config/org/bots/x/bot_token' }] },
      unknownRef: '@SECRETS/config/org/none/y/z',
      plain: 'keep-me',
    });
    expect(resolved.nested.arr[0].token).toBe('raw-x');
    expect(resolved.unknownRef).toBe('@SECRETS/config/org/none/y/z');
    expect(resolved.plain).toBe('keep-me');
  });
});
