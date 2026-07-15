/**
 * Access V2 / M1c — transparent RLS + atomic guarded writes.
 *
 * The database itself must enforce access on `files`: queries running under
 * `db.withAccess` (SET LOCAL ROLE app_user + `app.access` context) are
 * filtered/refused by the RLS policies — with NO predicate in the SQL. The
 * gold test: a RAW unfiltered SELECT must return EXACTLY the rows the pure
 * `checkAccess` engine accepts, for every principal × variant. Writes are
 * atomic: an out-of-scope INSERT/UPDATE/DELETE is refused by the statement
 * itself (0 rows / policy error), not by a separate app-side pre-check.
 * The owner path (plain `exec`, no context) stays unrestricted — migrations,
 * seeding, and system jobs are unaffected.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { getModules } from '@/lib/modules/registry';
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { resolveAccessPredicate } from '@/lib/auth/access-resolver';
import {
  checkAccess, buildAccessContext,
  type AccessPredicate, type AccessVariant,
} from '@/lib/auth/access-predicate';
import { AccessPermissionError } from '@/lib/errors';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { BaseFileContent, FileType } from '@/lib/types';

const DB = getTestDbPath('rls_enforcement');

function u(role: EffectiveUser['role'], home_folder: string, userId: number): EffectiveUser {
  return { userId, email: `u${userId}@x.co`, name: 'U', role, home_folder, mode: 'org' };
}

const ADMIN = u('admin', '', 1);
const VIEWER = u('viewer', 'sales', 2);   // conversations under /org/logs/conversations/2
const EDITOR = u('editor', 'sales', 3);

/** Editor + a group-style grant: build questions in /org/finance. */
function editorWithFinanceGrant(): AccessPredicate {
  const base = resolveAccessPredicate(EDITOR);
  return {
    ...base,
    grants: [
      ...base.grants,
      { allowedTypes: ['question'], createTypes: ['question'], scopes: [{ path: '/org/finance' }] },
    ],
  };
}

interface Row { id: number; path: string; type: FileType }
const rowsByPath = new Map<string, Row>();

async function seed(path: string, type: FileType = 'question'): Promise<Row> {
  const id = await DocumentDB.create(path.split('/').pop()!, path, type, {} as BaseFileContent, [], undefined, false);
  const row = { id, path, type };
  rowsByPath.set(path, row);
  return row;
}

/** RAW unfiltered SELECT under the caller's RLS context — the policy is the only filter. */
async function rlsSelect(p: AccessPredicate, variant: AccessVariant = 'access'): Promise<Set<number>> {
  const db = getModules().db;
  const res = await db.withAccess!<{ rows: { id: number }[] }>(
    buildAccessContext(p, variant),
    tx => tx.query<{ id: number }>('SELECT id FROM files ORDER BY id'),
  ) as unknown as { rows: { id: number }[] };
  return new Set(res.rows.map(r => r.id));
}

async function rlsExec(p: AccessPredicate, sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
  const db = getModules().db;
  return db.withAccess!(buildAccessContext(p), tx => tx.query(sql, params)) as Promise<{ rowCount: number }>;
}

/** Owner-path read (no context): must always see everything. */
async function ownerName(id: number): Promise<string> {
  const res = await getModules().db.exec<{ name: string }>('SELECT name FROM files WHERE id = $1', [id]);
  return res.rows[0]?.name ?? '(gone)';
}

describe('RLS enforcement on files (M1c)', () => {
  beforeAll(async () => {
    await initTestDatabase(DB);
    await seed('/org/sales/q1');
    await seed('/org/sales/team1/q2');
    await seed('/org/sales/del1');
    await seed('/org/marketing/m1');
    await seed('/org/marketing/del2');
    await seed('/org/marketing/d1', 'dashboard');
    await seed('/org/finance/f1');
    await seed('/org/database/pg', 'connection');
    await seed('/org/anc-context', 'context');       // ancestor context for home 'sales'
    await seed('/org/sales/sub-context', 'context');
    await seed('/org/logs/conversations/2/c1', 'conversation');
    await seed('/org/logs/conversations/3/c2', 'conversation');
    await seed('/org/logs/runs/r1', 'alert_run');
    await seed('/org/configs/extra-config', 'config');
    await seed('/tutorial/sales/tq');
    await seed('/org/zzz/high-id');                  // invisible to scoped users; max id in the table
  }, 30_000);
  afterAll(async () => { await cleanupTestDatabase(DB); });

  // ────────────────── gold parity: policy === checkAccess ──────────────────
  const PRINCIPALS: Array<[string, () => AccessPredicate]> = [
    ['admin', () => resolveAccessPredicate(ADMIN)],
    ['viewer home=sales', () => resolveAccessPredicate(VIEWER)],
    ['editor home=sales', () => resolveAccessPredicate(EDITOR)],
    ['editor + finance grant', editorWithFinanceGrant],
  ];
  const VARIANTS: AccessVariant[] = ['access', 'ui', 'embedded'];

  for (const [label, mk] of PRINCIPALS) {
    for (const variant of VARIANTS) {
      it(`raw SELECT under RLS === checkAccess: ${label} · ${variant}`, async () => {
        const p = mk();
        const all = await getModules().db.exec<Row>('SELECT id, path, type FROM files');
        const want = new Set(all.rows.filter(r => checkAccess(r, p, variant)).map(r => r.id));
        expect(await rlsSelect(p, variant)).toEqual(want);
      });
    }
  }

  it('embedded variant exposes readable-type rows outside path scopes; access does not', async () => {
    const p = resolveAccessPredicate(VIEWER);
    const m1 = rowsByPath.get('/org/marketing/m1')!;
    expect((await rlsSelect(p, 'embedded')).has(m1.id)).toBe(true);
    expect((await rlsSelect(p, 'access')).has(m1.id)).toBe(false);
  });

  it('ui variant additionally applies viewTypes (viewer cannot list connections)', async () => {
    const p = resolveAccessPredicate(VIEWER);
    const pg = rowsByPath.get('/org/database/pg')!;
    expect((await rlsSelect(p, 'access')).has(pg.id)).toBe(true);
    expect((await rlsSelect(p, 'ui')).has(pg.id)).toBe(false);
  });

  // ─────────────────────── atomic writes: UPDATE ───────────────────────────
  it('editor UPDATE outside scope affects 0 rows and leaves the row unchanged', async () => {
    const p = resolveAccessPredicate(EDITOR);
    const m1 = rowsByPath.get('/org/marketing/m1')!;
    const res = await rlsExec(p, 'UPDATE files SET name = $1 WHERE id = $2', ['hacked', m1.id]);
    expect(res.rowCount).toBe(0);
    expect(await ownerName(m1.id)).toBe('m1');
  });

  it('editor UPDATE inside home succeeds atomically', async () => {
    const p = resolveAccessPredicate(EDITOR);
    const q1 = rowsByPath.get('/org/sales/q1')!;
    const res = await rlsExec(p, 'UPDATE files SET name = $1 WHERE id = $2', ['renamed', q1.id]);
    expect(res.rowCount).toBe(1);
    expect(await ownerName(q1.id)).toBe('renamed');
  });

  it('viewer cannot UPDATE a question even in their own home (createTypes gate)', async () => {
    const p = resolveAccessPredicate(VIEWER);
    const q2 = rowsByPath.get('/org/sales/team1/q2')!;
    const res = await rlsExec(p, 'UPDATE files SET name = $1 WHERE id = $2', ['nope', q2.id]);
    expect(res.rowCount).toBe(0);
  });

  it('viewer CAN update their own conversation (createTypes includes conversation)', async () => {
    const p = resolveAccessPredicate(VIEWER);
    const c1 = rowsByPath.get('/org/logs/conversations/2/c1')!;
    const res = await rlsExec(p, 'UPDATE files SET name = $1 WHERE id = $2', ['my convo', c1.id]);
    expect(res.rowCount).toBe(1);
  });

  it('group grant authorizes UPDATE in the granted folder; base editor is refused there', async () => {
    const f1 = rowsByPath.get('/org/finance/f1')!;
    const denied = await rlsExec(resolveAccessPredicate(EDITOR), 'UPDATE files SET name = $1 WHERE id = $2', ['x', f1.id]);
    expect(denied.rowCount).toBe(0);
    const granted = await rlsExec(editorWithFinanceGrant(), 'UPDATE files SET name = $1 WHERE id = $2', ['granted-edit', f1.id]);
    expect(granted.rowCount).toBe(1);
  });

  it('mode isolation: org editor cannot UPDATE tutorial rows', async () => {
    const p = resolveAccessPredicate(EDITOR);
    const tq = rowsByPath.get('/tutorial/sales/tq')!;
    const res = await rlsExec(p, 'UPDATE files SET name = $1 WHERE id = $2', ['x', tq.id]);
    expect(res.rowCount).toBe(0);
  });

  it('admin UPDATE anywhere in their mode succeeds', async () => {
    const p = resolveAccessPredicate(ADMIN);
    const del2 = rowsByPath.get('/org/marketing/del2')!;
    const res = await rlsExec(p, 'UPDATE files SET name = $1 WHERE id = $2', ['admin-touch', del2.id]);
    expect(res.rowCount).toBe(1);
  });

  // ─────────────────────── atomic writes: DELETE ───────────────────────────
  it('editor DELETE outside home affects 0 rows; the row survives', async () => {
    const p = resolveAccessPredicate(EDITOR);
    const del2 = rowsByPath.get('/org/marketing/del2')!;
    const res = await rlsExec(p, 'DELETE FROM files WHERE id = $1', [del2.id]);
    expect(res.rowCount).toBe(0);
    expect(await ownerName(del2.id)).not.toBe('(gone)');
  });

  it('viewer DELETE inside their home succeeds (home = full delete rights)', async () => {
    const p = resolveAccessPredicate(VIEWER);
    const del1 = rowsByPath.get('/org/sales/del1')!;
    const res = await rlsExec(p, 'DELETE FROM files WHERE id = $1', [del1.id]);
    expect(res.rowCount).toBe(1);
  });

  // ─────────────────────── atomic writes: INSERT ───────────────────────────
  it('editor INSERT outside scope is refused by the policy itself', async () => {
    const p = resolveAccessPredicate(EDITOR);
    await expect(rlsExec(p,
      "INSERT INTO files (id, name, path, type, content, file_references, version, draft) VALUES ($1,$2,$3,$4,'{}','[]',1,false)",
      [90001, 'evil', '/org/marketing/evil', 'question'],
    )).rejects.toThrow(/row-level security|denied|policy/i);
    const res = await getModules().db.exec('SELECT id FROM files WHERE id = $1', [90001]);
    expect(res.rows.length).toBe(0);
  });

  it('editor INSERT into home succeeds; group grant INSERT into granted folder succeeds', async () => {
    const home = await rlsExec(resolveAccessPredicate(EDITOR),
      "INSERT INTO files (id, name, path, type, content, file_references, version, draft) VALUES ($1,$2,$3,$4,'{}','[]',1,false)",
      [90002, 'mine', '/org/sales/mine', 'question']);
    expect(home.rowCount).toBe(1);
    const granted = await rlsExec(editorWithFinanceGrant(),
      "INSERT INTO files (id, name, path, type, content, file_references, version, draft) VALUES ($1,$2,$3,$4,'{}','[]',1,false)",
      [90003, 'fin', '/org/finance/fin', 'question']);
    expect(granted.rowCount).toBe(1);
  });

  // ───────────────── DocumentDB wiring (access param) ──────────────────────
  it('DocumentDB.create under access context generates a NON-COLLIDING id (SECURITY DEFINER id gen)', async () => {
    // The scoped editor sees only a few rows; a naive MAX(id) over the RLS-filtered
    // table would collide with the invisible max row (/org/zzz/high-id + the 9000x raw inserts).
    const p = resolveAccessPredicate(EDITOR);
    const maxAll = (await getModules().db.exec<{ m: number }>('SELECT MAX(id) AS m FROM files')).rows[0].m;
    const id = await DocumentDB.create('new-q', '/org/sales/new-q', 'question', {} as BaseFileContent, [], undefined, false, null,
      { predicate: p });
    expect(id).toBeGreaterThan(maxAll);
  });

  it('DocumentDB.create under access context refuses an out-of-scope path', async () => {
    const p = resolveAccessPredicate(EDITOR);
    await expect(DocumentDB.create('evil2', '/org/marketing/evil2', 'question', {} as BaseFileContent, [], undefined, false, null,
      { predicate: p })).rejects.toThrow();
    const res = await getModules().db.exec('SELECT id FROM files WHERE path = $1', ['/org/marketing/evil2']);
    expect(res.rows.length).toBe(0);
  });

  it('DocumentDB.update under access context rejects an out-of-scope edit; row unchanged', async () => {
    const p = resolveAccessPredicate(EDITOR);
    const m1 = rowsByPath.get('/org/marketing/m1')!;
    await expect(DocumentDB.update(m1.id, 'hacked', m1.path, {} as BaseFileContent, [], 'e1', undefined,
      { predicate: p })).rejects.toThrow();
    expect(await ownerName(m1.id)).toBe('m1');
  });

  it('DocumentDB.update under access context rejects readable-but-not-editable rows (viewer, permission error)', async () => {
    const p = resolveAccessPredicate(VIEWER);
    const q2 = rowsByPath.get('/org/sales/team1/q2')!;
    await expect(DocumentDB.update(q2.id, 'nope', q2.path, {} as BaseFileContent, [], 'e2', undefined,
      { predicate: p })).rejects.toThrow(AccessPermissionError);
    expect(await ownerName(q2.id)).toBe('q2');
  });

  it('DocumentDB.deleteByIds under access context deletes 0 out-of-scope rows', async () => {
    const p = resolveAccessPredicate(EDITOR);
    const m1 = rowsByPath.get('/org/marketing/m1')!;
    expect(await DocumentDB.deleteByIds([m1.id], { predicate: p })).toBe(0);
    expect(await ownerName(m1.id)).toBe('m1');
  });

  // ───────────────────────── behavior preservation ─────────────────────────
  it('loadFile on a forbidden file still raises AccessPermissionError (403, not a silent 404)', async () => {
    const m1 = rowsByPath.get('/org/marketing/m1')!;
    await expect(FilesAPI.loadFile(m1.id, EDITOR)).rejects.toThrow(AccessPermissionError);
  });

  it('owner path (plain exec, no context) is unrestricted', async () => {
    const db = getModules().db;
    const all = await db.exec<{ n: number }>('SELECT COUNT(*)::int AS n FROM files');
    expect(all.rows[0].n).toBeGreaterThanOrEqual(rowsByPath.size);
    const del2 = rowsByPath.get('/org/marketing/del2')!;
    const res = await db.exec('UPDATE files SET name = $1 WHERE id = $2', ['owner-touch', del2.id]);
    expect(res.rowCount).toBe(1);
  });
});
