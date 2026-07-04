// Local generic event log (app_events): every published app-event is stored here,
// replacing the central events DB. Typed analytics tables (file_events, llm_call_events,
// …) remain for their specific queries; this is the raw catch-all audit log.

import { describe, it, expect } from 'vitest';
import { recordAppEvent } from '@/lib/analytics/app-events.db';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('app_events_store');

async function rows() {
  const r = await getModules().db.exec<{ event_type: string; mode: string | null; user_id: number | null; user_email: string | null; payload: Record<string, unknown> }>(
    'SELECT event_type, mode, user_id, user_email, payload FROM app_events ORDER BY id',
  );
  return r.rows;
}

describe('recordAppEvent → app_events', () => {
  setupTestDb(TEST_DB_PATH);

  it('stores an event with its type, attribution columns, and full payload', async () => {
    await recordAppEvent('share:lead', {
      mode: 'org', fileId: 1, name: 'Jane', email: 'jane@acme.test', userEmail: 'jane@acme.test', userId: 42,
    });
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0].event_type).toBe('share:lead');
    expect(r[0].mode).toBe('org');
    expect(r[0].user_id).toBe(42);
    expect(r[0].user_email).toBe('jane@acme.test');
    expect(r[0].payload).toMatchObject({ fileId: 1, name: 'Jane', email: 'jane@acme.test' });
  });

  it('handles missing attribution fields (nulls) and never throws', async () => {
    await recordAppEvent('mcp:tool_call', { mode: 'org', sessionId: 's', tool: 't' });
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0].user_id).toBeNull();
    expect(r[0].user_email).toBeNull();
    expect(r[0].payload).toMatchObject({ tool: 't' });
  });
});
