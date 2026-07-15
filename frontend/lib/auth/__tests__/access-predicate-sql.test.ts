/**
 * M1b gold parity: the compiled SQL (`toSql`) must select EXACTLY the rows the
 * in-memory `checkAccess` accepts. We insert a matrix of files into a real
 * PGLite `files` table, run `SELECT id ... WHERE <toSql>`, and assert the row
 * set equals the `checkAccess`-true set — for every principal × variant.
 *
 * This is the enforcement's safety net: if the SQL and the engine ever diverge,
 * a real query proves it here, not a user's data leaking in production.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { FileType } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { Mode } from '@/lib/mode/mode-types';
import { checkAccess, toSql, type AccessVariant } from '@/lib/auth/access-predicate';
import { resolveAccessPredicate } from '@/lib/auth/access-resolver';

function user(role: EffectiveUser['role'], home_folder: string, mode: Mode, userId = 1): EffectiveUser {
  return { userId, email: `u${userId}@x.co`, name: 'U', role, home_folder, mode };
}

const USERS: EffectiveUser[] = [
  user('admin', '', 'org'),
  user('admin', 'sales', 'tutorial'),
  user('editor', '', 'org'),
  user('editor', 'sales', 'org'),
  user('editor', 'sales/team1', 'org'),
  user('viewer', '', 'org'),
  user('viewer', 'sales', 'org', 2),
  user('viewer', 'sales/team1', 'tutorial', 12),
];

const TYPES: FileType[] = ['question', 'dashboard', 'folder', 'context', 'connection', 'config', 'conversation', 'alert_run'];

function makePaths(): string[] {
  const out: string[] = [];
  for (const mode of ['org', 'tutorial'] as Mode[]) {
    const r = `/${mode}`;
    out.push(
      r, `${r}/sales`, `${r}/sales/q1`, `${r}/sales/team1`, `${r}/sales/team1/x`,
      `${r}/marketing/x`, `${r}/context`, `${r}/sales/context`,
      `${r}/database`, `${r}/database/pg`, `${r}/configs/config`, `${r}/config`,
      `${r}/logs/conversations/1`, `${r}/logs/conversations/1/c`,
      `${r}/logs/conversations/12`, `${r}/logs/conversations/2/c`,
      `${r}/logs/runs`, `${r}/logs/runs/r1`, `${r}/recordings/x`,
      `/othermode/sales/q1`,
    );
  }
  return out;
}

interface Row { id: number; path: string; type: FileType }
const ROWS: Row[] = [];
{
  let id = 1;
  for (const type of TYPES) for (const path of makePaths()) ROWS.push({ id: id++, path, type });
}

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE files (id int primary key, path text, type text);');
  for (const r of ROWS) await db.query('INSERT INTO files (id, path, type) VALUES ($1,$2,$3)', [r.id, r.path, r.type]);
});
afterAll(async () => { await db.close(); });

async function sqlIds(sql: string, params: unknown[]): Promise<Set<number>> {
  const res = await db.query<{ id: number }>(`SELECT id FROM files WHERE ${sql}`, params);
  return new Set(res.rows.map(r => r.id));
}

const VARIANTS: AccessVariant[] = ['access', 'ui', 'embedded'];

describe('toSql selects exactly the checkAccess-accepted rows (PGLite)', () => {
  for (const u of USERS) {
    for (const variant of VARIANTS) {
      it(`${u.role} home=${u.home_folder || '/'} mode=${u.mode} · ${variant}`, async () => {
        const p = resolveAccessPredicate(u);
        const want = new Set(ROWS.filter(r => checkAccess(r, p, variant)).map(r => r.id));
        const frag = toSql(p, variant);
        const got = await sqlIds(frag.sql, frag.params);
        // Symmetric-difference must be empty.
        const missing = [...want].filter(id => !got.has(id));
        const extra = [...got].filter(id => !want.has(id));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      });
    }
  }

  it('supports a param offset (composes into a larger query)', async () => {
    const p = resolveAccessPredicate(user('editor', 'sales', 'org'));
    const frag = toSql(p, 'access', { paramOffset: 1 });
    const res = await db.query<{ id: number }>(
      `SELECT id FROM files WHERE type = $1 AND (${frag.sql})`,
      ['question', ...frag.params],
    );
    const want = new Set(ROWS.filter(r => r.type === 'question' && checkAccess(r, p, 'access')).map(r => r.id));
    expect(new Set(res.rows.map(r => r.id))).toEqual(want);
  });
});
