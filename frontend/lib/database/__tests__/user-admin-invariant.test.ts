/**
 * Lockout guard: a workspace must always keep ≥ 1 admin. Demoting or deleting
 * the LAST admin is refused at the data layer (UserDB), so every caller —
 * users API, future admin tooling — is covered. With a second admin present,
 * both operations are allowed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { UserDB } from '@/lib/database/user-db';

const DB = getTestDbPath('admin_invariant');

describe('last-admin invariant', () => {
  beforeAll(async () => { await initTestDatabase(DB); }, 30_000);
  afterAll(async () => { await cleanupTestDatabase(DB); });

  it('refuses to demote the last admin', async () => {
    const admins = (await UserDB.listAll()).filter(u => u.role === 'admin');
    expect(admins.length).toBe(1); // seeded workspace has exactly one
    await expect(UserDB.update(admins[0].id, { role: 'viewer' })).rejects.toThrow(/last admin/i);
  });

  it('refuses to delete the last admin', async () => {
    const admin = (await UserDB.listAll()).find(u => u.role === 'admin')!;
    await expect(UserDB.delete(admin.id)).rejects.toThrow(/last admin/i);
  });

  it('allows demotion and deletion when another admin exists', async () => {
    const admin = (await UserDB.listAll()).find(u => u.role === 'admin')!;
    const second = await UserDB.create('second@x.co', 'Second', '', { role: 'admin', password_hash: 'hash' });
    await UserDB.update(second, { role: 'viewer' });          // demote the SECOND admin — fine
    expect((await UserDB.getById(second))?.role).toBe('viewer');
    await UserDB.update(second, { role: 'admin' });           // restore
    await UserDB.delete(second);                              // delete the second admin — fine
    expect(await UserDB.getById(second)).toBeNull();
    expect((await UserDB.getById(admin.id))?.role).toBe('admin');
  });
});
