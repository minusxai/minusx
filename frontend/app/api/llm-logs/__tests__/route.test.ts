// DELETE /api/llm-logs — clears the llm_logs blobs (Settings → Data Management).
// Admin-only; `?before=<date>` scopes the deletion. The underlying date-scoped
// delete is covered in lib/analytics/__tests__/llm-logs.test.ts.

vi.mock('@/lib/auth/auth-helpers', () => ({ getEffectiveUser: vi.fn() }));

import { describe, it, expect, vi, type Mock } from 'vitest';
import { DELETE } from '@/app/api/llm-logs/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('llm_logs_clear_route');

async function seed(callId: string, createdAt: string): Promise<void> {
  await getModules().db.exec(
    `INSERT INTO llm_logs (call_id, request_json, created_at) VALUES ($1, $2, $3)`,
    [callId, '{"q":1}', createdAt],
  );
}
const del = (qs: string) => DELETE(new NextRequest(`http://localhost/api/llm-logs${qs}`, { method: 'DELETE' }));

describe('DELETE /api/llm-logs', () => {
  setupTestDb(TEST_DB_PATH);

  it('clears only logs before the given date (admin)', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'admin', userId: 1 });
    await seed('old', '2020-01-01T00:00:00.000Z');
    await seed('new', '2030-01-01T00:00:00.000Z');

    const res = await del('?before=2025-01-01T00:00:00.000Z');
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(1);

    const rows = await getModules().db.exec<{ call_id: string }>(`SELECT call_id FROM llm_logs`);
    expect(rows.rows.map((r) => r.call_id)).toEqual(['new']);
  });

  it('forbids non-admins', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'user', userId: 2 });
    expect((await del('?before=2025-01-01T00:00:00.000Z')).status).toBe(403);
  });

  it('rejects an invalid date', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'admin', userId: 1 });
    expect((await del('?before=not-a-date')).status).toBe(400);
  });
});
