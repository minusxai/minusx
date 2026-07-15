/**
 * Access explainability (M3): "who can see this folder" and "why does this
 * user have access" must agree with the enforcement primitives.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { UserDB } from '@/lib/database/user-db';
import { createGroup } from '@/lib/data/groups.server';
import { folderAccessReport, userAccessReport } from '@/lib/data/access-report.server';

const DB = getTestDbPath('access_report');
const adminUser = { userId: 1, email: 'a@x.co', name: 'A', role: 'admin' as const, home_folder: '', mode: 'org' as const };
let salesUserId: number;

describe('access reports', () => {
  beforeAll(async () => {
    await initTestDatabase(DB);
    salesUserId = await UserDB.create('sales@x.co', 'Sales', 'sales', { role: 'viewer', password_hash: 'h' });
    await createGroup({
      name: 'Finance-Builders',
      allowedTypes: ['question'], viewTypes: ['question'], createTypes: ['question'],
      folders: ['finance'], memberIds: [salesUserId],
    }, adminUser);
  }, 30_000);
  afterAll(async () => { await cleanupTestDatabase(DB); });

  it('folder report: /finance shows admins, the group (write), not the sales home user', async () => {
    const entries = await folderAccessReport('/finance', 'org');
    const kinds = entries.map(e => `${e.kind}:${e.label}`);
    expect(kinds.some(k => k.startsWith('admin-role'))).toBe(true);
    const group = entries.find(e => e.kind === 'group' && e.label === 'Finance-Builders')!;
    expect(group.write).toBe(true);
    expect(group.users).toContain('sales@x.co');
    expect(entries.some(e => e.kind === 'home-folder')).toBe(false); // nobody's home covers /finance
  });

  it('folder report: /sales shows the home-folder user with editor/viewer write flag', async () => {
    const entries = await folderAccessReport('/sales', 'org');
    const home = entries.find(e => e.kind === 'home-folder')!;
    expect(home.users).toContain('sales@x.co');
    expect(home.write).toBe(false); // viewer
  });

  it('user report explains role + home + group', async () => {
    const entries = await userAccessReport(salesUserId, 'org');
    const sources = entries.map(e => e.source);
    expect(sources).toContain('role');
    expect(sources).toContain('home-folder');
    const group = entries.find(e => e.source === 'group')!;
    expect(group.label).toContain('Finance-Builders');
    expect(group.detail).toMatch(/build/i);
    expect(group.detail).toContain('/finance');
  });

  it('admin user report is just the role explanation', async () => {
    const admin = (await UserDB.listAll()).find(u => u.role === 'admin')!;
    const entries = await userAccessReport(admin.id, 'org');
    expect(entries.length).toBe(1);
    expect(entries[0].source).toBe('role');
  });
});
