// Previously-silent privileged mutations must publish an audit event.
// Spy on the singleton registry's publish and drive the DATA LAYER directly
// (the publishes live in the deep modules, so every caller inherits them).

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { saveConfig } from '@/lib/data/configs.server';
import { createConnection, deleteConnection } from '@/lib/data/connections.server';
import { FilesAPI, addShare, revokeShare } from '@/lib/data/files.server';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

setupTestDb(getTestDbPath('mutation_events'));

const USER = { userId: 1, email: 'admin@x.co', name: 'A', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

// Capture through the registry's own API (subscribeAll handlers are invoked
// synchronously inside publish), rather than mocking the singleton.
const captured: { event: string; payload: Record<string, unknown> }[] = [];
appEventRegistry.subscribeAll((event, payload) => {
  captured.push({ event, payload: payload as unknown as Record<string, unknown> });
});

function published(event: string): Record<string, unknown>[] {
  return captured.filter((c) => c.event === event).map((c) => c.payload);
}

beforeEach(() => { captured.length = 0; });
const publishSpy = { mockClear: () => { captured.length = 0; } };

describe('privileged mutations publish audit events', () => {
  it('saveConfig publishes config:updated with top-level changed keys (never values)', async () => {
    await saveConfig({ branding: { agentName: 'TestBot' } } as never, USER);

    const events = published(AppEvents.CONFIG_UPDATED);
    expect(events).toHaveLength(1);
    expect(events[0].changedKeys).toEqual(['branding']);
    expect(events[0].mode).toBe('org');
    expect(events[0].userId).toBe(1);
    // Values must never ride the event — the config carries credentials.
    expect(JSON.stringify(events[0])).not.toContain('TestBot');
  });

  it('createConnection / deleteConnection publish connection lifecycle events', async () => {
    await createConnection({ name: 'evt_test_conn', type: 'csv', config: {} }, USER);
    const created = published(AppEvents.CONNECTION_CREATED);
    expect(created).toHaveLength(1);
    expect(created[0].connectionName).toBe('evt_test_conn');
    expect(created[0].connectionType).toBe('csv');

    await deleteConnection('evt_test_conn', USER);
    const deleted = published(AppEvents.CONNECTION_DELETED);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].connectionName).toBe('evt_test_conn');
  });

  it('addShare / revokeShare publish share lifecycle events', async () => {
    const created = await FilesAPI.createFile(
      { name: 'Shared story', path: '/org/shared-story', type: 'story', content: { description: null, assets: [], story: '<h1>Hi</h1>' } as never },
      USER,
    );
    const fileId = created.data.id;
    publishSpy.mockClear(); // drop the FILE_CREATED noise

    const share = await addShare(fileId, USER, 'test label');
    const createdEvents = published(AppEvents.SHARE_CREATED);
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0].fileId).toBe(fileId);
    expect(createdEvents[0].label).toBe('test label');
    const nonce = String(createdEvents[0].nonce);
    expect(nonce.length).toBeGreaterThan(0);

    await revokeShare(fileId, USER, nonce);
    const revokedEvents = published(AppEvents.SHARE_REVOKED);
    expect(revokedEvents).toHaveLength(1);
    expect(revokedEvents[0].nonce).toBe(nonce);
  });

  it('moveFile publishes file:updated (rename/move previously left no trace)', async () => {
    const created = await FilesAPI.createFile(
      { name: 'Movable', path: '/org/movable-file', type: 'story', content: { description: null, assets: [], story: '<h1>m</h1>' } as never },
      USER,
    );
    const fileId = created.data.id;
    publishSpy.mockClear();

    await FilesAPI.moveFile({ id: fileId, name: 'Moved', newPath: '/org/moved-file' }, USER);

    const events = published(AppEvents.FILE_UPDATED).filter((p) => p.fileId === fileId);
    expect(events).toHaveLength(1);
    expect(events[0].filePath).toBe('/org/moved-file');
  });

  it('sanity: the app_events sink stores a published audit event', async () => {
    await saveConfig({ thinkingPhrases: [] }, USER);
    // The sink write is fire-and-forget — poll briefly.
    let row: Record<string, unknown> | undefined;
    for (let i = 0; i < 40 && !row; i++) {
      const r = await getModules().db.exec<Record<string, unknown>>(
        `SELECT event_type, payload FROM app_events WHERE event_type = 'config:updated' LIMIT 1`,
      );
      row = r.rows[0];
      if (!row) await new Promise((res) => setTimeout(res, 25));
    }
    expect(row, 'config:updated should land in app_events via the subscribeAll sink').toBeTruthy();
  });
});
