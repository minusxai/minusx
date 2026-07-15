/**
 * M1a characterization battery. The new `checkAccess(resolveAccessPredicate())`
 * engine must reproduce today's access decision EXACTLY. We freeze verbatim
 * copies of the current `permissions.ts` logic (`legacy*` below) and assert the
 * new engine agrees across a full matrix of principals × files × variants.
 *
 * These frozen copies are the anchor: even after `permissions.ts` is switched
 * to delegate to the engine, this test still guards the engine against the
 * original behavior. If it ever goes red, the refactor changed a decision.
 */
import { describe, it, expect } from 'vitest';
import type { DbFile, FileType } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { AccessRulesOverride } from '@/lib/branding/whitelabel';
import { canAccessFileType, canViewFileType } from '@/lib/auth/access-rules';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolvePath, resolveHomeFolderSync, isUnderSystemFolder } from '@/lib/mode/path-resolver';
import type { Mode } from '@/lib/mode/mode-types';
import { checkAccess } from '@/lib/auth/access-predicate';
import { resolveAccessPredicate } from '@/lib/auth/access-resolver';

// ───────────────────────── frozen legacy (verbatim from permissions.ts) ─────

function legacyIsAccessibleSystemPath(path: string, user: EffectiveUser): boolean {
  const databaseFolder = resolvePath(user.mode, '/database');
  if (path === databaseFolder || path.startsWith(databaseFolder + '/')) return true;
  const userId = user.userId?.toString() || user.email;
  const userConversationFolder = resolvePath(user.mode, `/logs/conversations/${userId}`);
  if (path.startsWith(userConversationFolder)) return true;
  const runsFolder = resolvePath(user.mode, '/logs/runs');
  if (path === runsFolder || path.startsWith(runsFolder + '/')) return true;
  return false;
}

function legacyIsAncestorContext(file: DbFile, user: EffectiveUser): boolean {
  if (file.type !== 'context') return false;
  if (!user.home_folder) return false;
  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
  const contextDir = file.path.substring(0, file.path.lastIndexOf('/'));
  return resolvedHomeFolder === contextDir || resolvedHomeFolder.startsWith(contextDir + '/');
}

function legacyCanAccessFile(file: DbFile, user: EffectiveUser, overrides?: AccessRulesOverride): boolean {
  if (!canAccessFileType(user.role, file.type, overrides)) return false;
  const modePrefix = `/${user.mode}`;
  if (!file.path.startsWith(modePrefix + '/') && file.path !== modePrefix) return false;
  if (isAdmin(user.role)) return true;
  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
  const homeAccess =
    (file.path === resolvedHomeFolder || file.path.startsWith(resolvedHomeFolder + '/'))
    && !isUnderSystemFolder(file.path, user.mode as Mode);
  if (homeAccess) return true;
  if (legacyIsAccessibleSystemPath(file.path, user)) return true;
  if (legacyIsAncestorContext(file, user)) return true;
  return false;
}

function legacyCanViewFileInUI(file: DbFile, user: EffectiveUser, overrides?: AccessRulesOverride): boolean {
  if (!legacyCanAccessFile(file, user, overrides)) return false;
  if (!canViewFileType(user.role, file.type, overrides)) return false;
  return true;
}

function legacyEmbedded(ref: DbFile, user: EffectiveUser, overrides?: AccessRulesOverride): boolean {
  const modePrefix = `/${user.mode}`;
  if (!canAccessFileType(user.role, ref.type, overrides)) return false;
  return ref.path === modePrefix || ref.path.startsWith(modePrefix + '/');
}

// ───────────────────────── matrix ───────────────────────────────────────────

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
  user('editor', 'marketing', 'org', 1),
];

const TYPES: FileType[] = [
  'question', 'dashboard', 'folder', 'context', 'connection', 'config',
  'conversation', 'notebook', 'story', 'alert_run', 'report_run',
];

function makePaths(): string[] {
  const paths: string[] = [];
  for (const mode of ['org', 'tutorial'] as Mode[]) {
    const r = `/${mode}`;
    paths.push(
      r, `${r}/sales`, `${r}/sales/q1`, `${r}/sales/team1`, `${r}/sales/team1/x`,
      `${r}/marketing/x`, `${r}/context`, `${r}/sales/context`,
      `${r}/database`, `${r}/database/pg`,
      `${r}/logs/conversations/1`, `${r}/logs/conversations/1/c`,
      `${r}/logs/conversations/12`, `${r}/logs/conversations/2/c`,
      `${r}/logs/runs`, `${r}/logs/runs/r1`,
      `/othermode/sales/q1`,
    );
  }
  return paths;
}

function file(id: number, type: FileType, path: string): DbFile {
  return { id, name: 'f', path, type, content: {}, version: 1 } as unknown as DbFile;
}

describe('checkAccess parity with legacy permissions.ts', () => {
  const paths = makePaths();

  it('matches legacyCanAccessFile across the full matrix (variant: access)', () => {
    const mismatches: string[] = [];
    for (const u of USERS) {
      const p = resolveAccessPredicate(u);
      for (const t of TYPES) for (const path of paths) {
        const f = file(1, t, path);
        const got = checkAccess(f, p, 'access');
        const want = legacyCanAccessFile(f, u);
        if (got !== want) mismatches.push(`access ${u.role} home=${u.home_folder || '/'} mode=${u.mode} | ${t} ${path} | got=${got} want=${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('matches legacyCanViewFileInUI across the full matrix (variant: ui)', () => {
    const mismatches: string[] = [];
    for (const u of USERS) {
      const p = resolveAccessPredicate(u);
      for (const t of TYPES) for (const path of paths) {
        const f = file(1, t, path);
        const got = checkAccess(f, p, 'ui');
        const want = legacyCanViewFileInUI(f, u);
        if (got !== want) mismatches.push(`ui ${u.role} ${t} ${path} got=${got} want=${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('matches the legacy embedded-reference rule (variant: embedded)', () => {
    const mismatches: string[] = [];
    for (const u of USERS) {
      const p = resolveAccessPredicate(u);
      for (const t of TYPES) for (const path of paths) {
        const f = file(1, t, path);
        const got = checkAccess(f, p, 'embedded');
        const want = legacyEmbedded(f, u);
        if (got !== want) mismatches.push(`embedded ${u.role} ${t} ${path} got=${got} want=${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('honors config accessRules overrides identically', () => {
    const overrides: AccessRulesOverride = { editor: { viewTypes: ['question'] } };
    const u = user('editor', 'sales', 'org');
    const p = resolveAccessPredicate(u, overrides);
    for (const t of TYPES) for (const path of paths) {
      const f = file(1, t, path);
      expect(checkAccess(f, p, 'ui')).toBe(legacyCanViewFileInUI(f, u, overrides));
      expect(checkAccess(f, p, 'access')).toBe(legacyCanAccessFile(f, u, overrides));
    }
  });
});
