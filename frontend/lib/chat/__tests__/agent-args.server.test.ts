/**
 * buildServerAgentArgs — schema resolution.
 *
 * The client no longer sends agent_args.schema; the server resolves the prompt
 * schema entirely from the DB. Normally it comes from the nearest context's
 * whitelisted schema, but during onboarding the context is still being built and
 * whitelists nothing — so the server must fall back to the selected connection's
 * own PERSISTED schema (the same persisted schema the client used to read and
 * forward). These tests pin both paths.
 */
import { describe, it, expect } from 'vitest';
import { setupTestDb } from '@/test/harness/test-db';
import { DocumentDB } from '@/lib/database/documents-db';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, ConnectionContent, DatabaseSchema } from '@/lib/types';

const TEST_DB_PATH = '/tmp/agent_args_server_test.db';

const USER: EffectiveUser = {
  userId: 1,
  email: 'x@y.z',
  name: 'X',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
} as unknown as EffectiveUser;

function persistedSchema(tableMarker: string): DatabaseSchema {
  return {
    schemas: [
      { schema: 'main', tables: [{ table: tableMarker, columns: [{ name: 'id', type: 'INTEGER' }] }] },
    ],
    updated_at: new Date().toISOString(),
  };
}

describe('buildServerAgentArgs — schema resolution', () => {
  setupTestDb(TEST_DB_PATH);

  it("falls back to the selected connection's persisted schema when the context whitelists none (onboarding cold-start)", async () => {
    // Context being built: nothing whitelisted yet.
    const emptyCtx: ContextContent = { published: { all: 1 }, versions: [], fullSchema: [], fullDocs: [] };
    const ctxId = await DocumentDB.create('cold-context', '/org/cold-context', 'context', emptyCtx, []);

    // Connection carries a persisted schema — the same source the client read from.
    const connContent: ConnectionContent = {
      type: 'duckdb',
      config: {},
      schema: persistedSchema('FallbackOrders'),
    };
    await DocumentDB.create('fallbackdb', '/org/database/fallbackdb', 'connection', connContent, [], undefined, false);

    const args = await buildServerAgentArgs(USER, { contextFileId: ctxId, connectionId: 'fallbackdb' });

    expect(args.connection_id).toBe('fallbackdb');
    expect(args.schema).toEqual([{ schema: 'main', tables: ['FallbackOrders'] }]);
  });

  it('resolves schema from the context (whitelist) when one is present — fallback does not swallow it', async () => {
    // Root context with a published version whitelisting everything. On load the
    // context loader recomputes fullSchema from the whitelisted connections'
    // persisted schemas, so the agent gets the context-resolved schema (the
    // length>0 path) rather than the connection fallback.
    const ctxContent: ContextContent = {
      published: { all: 1 },
      versions: [
        {
          version: 1,
          whitelist: '*',
          docs: [],
          createdAt: new Date().toISOString(),
          createdBy: 1,
        },
      ],
    } as unknown as ContextContent;
    const ctxId = await DocumentDB.create('warm-context', '/org/warm-context', 'context', ctxContent, []);

    const connContent: ConnectionContent = {
      type: 'duckdb',
      config: {},
      schema: persistedSchema('CtxUsers'),
    };
    await DocumentDB.create('ctxdb', '/org/database/ctxdb', 'connection', connContent, [], undefined, false);

    const args = await buildServerAgentArgs(USER, { contextFileId: ctxId, connectionId: 'ctxdb' });

    expect(args.connection_id).toBe('ctxdb');
    expect(args.schema).toEqual([{ schema: 'main', tables: ['CtxUsers'] }]);
  });

  it('does NOT lock to a connection when MULTIPLE are available and none is selected (Slack/remote) — the agent picks', async () => {
    // Context whitelisting two connections, no UI selection (no connectionId) → ambiguous.
    const ctxContent = {
      published: { all: 1 },
      versions: [{
        version: 1,
        whitelist: [
          { name: 'multi_a', type: 'connection' },
          { name: 'multi_b', type: 'connection' },
        ],
        docs: [], createdAt: new Date().toISOString(), createdBy: 1,
      }],
    } as unknown as ContextContent;
    const ctxId = await DocumentDB.create('multi-context', '/org/multi-context', 'context', ctxContent, []);
    await DocumentDB.create('multi_a', '/org/database/multi_a', 'connection', { type: 'duckdb', config: {}, schema: persistedSchema('TableA') }, [], undefined, false);
    await DocumentDB.create('multi_b', '/org/database/multi_b', 'connection', { type: 'duckdb', config: {}, schema: persistedSchema('TableB') }, [], undefined, false);

    const args = await buildServerAgentArgs(USER, { contextFileId: ctxId }); // NO connectionId

    expect(args.connection_id).toBeUndefined();  // never the first — the agent must choose via ListDBConnections
    expect(args.schema).toEqual([]);             // no upfront schema → discover the picked connection on demand
  });

  it('uses the only whitelisted connection when exactly one is available, even without a UI selection', async () => {
    const ctxContent = {
      published: { all: 1 },
      versions: [{
        version: 1,
        whitelist: [{ name: 'solo_conn', type: 'connection' }],
        docs: [], createdAt: new Date().toISOString(), createdBy: 1,
      }],
    } as unknown as ContextContent;
    const ctxId = await DocumentDB.create('solo-context', '/org/solo-context', 'context', ctxContent, []);
    await DocumentDB.create('solo_conn', '/org/database/solo_conn', 'connection', { type: 'duckdb', config: {}, schema: persistedSchema('SoloTable') }, [], undefined, false);

    const args = await buildServerAgentArgs(USER, { contextFileId: ctxId }); // NO connectionId

    expect(args.connection_id).toBe('solo_conn'); // unambiguous single connection → still provided
  });
});
