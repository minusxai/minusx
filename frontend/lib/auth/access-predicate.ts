/**
 * Access V2 — the single, pure evaluation engine for "can this principal touch
 * this file". `checkAccess` is the in-memory evaluator; in M1b the SAME
 * `AccessPredicate` structure compiles to a SQL `WHERE` fragment, so the two
 * enforcement paths can never diverge.
 *
 * Pure: no DB, no `server-only`, no `fs`. The resolver (`access-resolver.ts`)
 * turns an `EffectiveUser` (+ config overrides, and later group memberships)
 * into an `AccessPredicate`; this file only interprets it.
 *
 * M1a reproduces today's read/access decision EXACTLY (`canAccessFile`,
 * `canViewFileInUI`, and the embedded-reference variant) — verified by the
 * differential characterization battery in `__tests__/access-predicate.test.ts`.
 */
import type { FileType } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import { isUnderSystemFolder, resolvePath, HIDDEN_SYSTEM_FOLDERS } from '@/lib/mode/path-resolver';

export type TypeSet = '*' | FileType[];

/**
 * Which checks apply — mirrors today's two reference variants plus UI listing:
 * - `access`   — full check (type + mode + path). `canAccessFile`. Folder
 *                children, direct loads, API access.
 * - `embedded` — embedded assets (a dashboard's questions): type + mode only,
 *                no path scope — they travel with the container you can open.
 * - `ui`       — `access` plus the `viewTypes` gate. `canViewFileInUI`.
 *                Search results, folder-browser listings.
 */
export type AccessVariant = 'access' | 'embedded' | 'ui';

/** One resolved absolute path prefix that grants access (OR'd across scopes). */
export interface AccessScope {
  /** Resolved absolute path prefix, e.g. `/org/sales`. */
  path: string;
  /** Home folder only: exclude system subfolders (re-granted via explicit system scopes). */
  excludeSystem?: boolean;
  /** Conversation folder: raw `startsWith`, no `/` boundary — reproduces legacy behavior. */
  matchRaw?: boolean;
}

/**
 * One grant = a capability set applied over a set of scopes. Effective access
 * is the UNION across grants, and WITHIN a grant it's capabilities ∩ scopes —
 * so a viewer added to an "edit /finance" group edits in finance and only views
 * elsewhere. The base grant (from the user's role) reproduces today's behavior;
 * group memberships (M2) append more grants.
 */
export interface AccessGrant {
  /** Types this grant permits (`canAccessFileType` basis for the base grant). */
  allowedTypes: TypeSet;
  /**
   * Types this grant permits WRITING (create/edit/delete) within its scopes.
   * The base (role) grant leaves this empty — base write rights are enforced
   * by the existing role + home-folder logic; group grants set it from the
   * group's `createTypes`, making write-sharing additive.
   */
  createTypes?: TypeSet;
  /** Absolute path prefixes this grant covers (empty for admin = whole mode). */
  scopes: AccessScope[];
}

/**
 * Base (role + home-folder) WRITE rights — the legacy write rules, snapshotted
 * so the RLS write policies (M1c) can enforce them in the database:
 * - create: role `createTypes` within the home/conversation folders (raw prefix)
 * - update: role `createTypes` within anything readable (`canAccessFile` ∩ `canCreateFileByRole`)
 * - delete: any type within the home folder (the static type blocklists stay
 *   app-side — they're not per-principal, and cascade folder-deletes must keep
 *   removing their `context` children)
 * Group grants add to these via each grant's `createTypes` ∩ scopes.
 */
export interface BaseWriteRights {
  /** Role `createTypes` (undefined rule field → permissive, like `canCreateFileByRole`). */
  createTypes: TypeSet;
  /** Where the role may CREATE (home + own conversation folder, raw prefix). */
  createScopes: AccessScope[];
  /** Where the role may DELETE (home folder, raw prefix). */
  deleteScopes: AccessScope[];
}

/**
 * A principal's resolved access, as a self-contained snapshot. Admins bypass
 * mode-scoped path checks (but still obey mode isolation + type).
 */
export interface AccessPredicate {
  admin: boolean;
  mode: Mode;
  /** Access grants — OR'd; within each, types ∩ scopes. */
  grants: AccessGrant[];
  /** `canViewFileType` basis (UI variant gate). */
  viewTypes: TypeSet;
  /** Non-admin resolved home folder — for the ancestor-context rule; null if none/admin. */
  homeFolder: string | null;
  /** Base write rights for the RLS write policies; absent for admins (full write). */
  baseWrite?: BaseWriteRights;
}

function typeAllowed(type: FileType, set: TypeSet): boolean {
  return set === '*' || set.includes(type);
}

function scopeMatches(filePath: string, s: AccessScope, mode: Mode): boolean {
  const hit = s.matchRaw
    ? filePath.startsWith(s.path)
    : filePath === s.path || filePath.startsWith(s.path + '/');
  if (!hit) return false;
  if (s.excludeSystem && isUnderSystemFolder(filePath, mode)) return false;
  return true;
}

/** A context file whose directory is an ancestor of the home folder (hierarchical schema filtering). */
function isAncestorContext(type: FileType, path: string, homeFolder: string | null): boolean {
  if (type !== 'context' || !homeFolder) return false;
  const dir = path.substring(0, path.lastIndexOf('/'));
  return homeFolder === dir || homeFolder.startsWith(dir + '/');
}

/**
 * Evaluate a principal's access to one file. Pure and total. Reproduces
 * `canAccessFile` (`access`), `canViewFileInUI` (`ui`), and the embedded-asset
 * reference rule (`embedded`) exactly.
 */
export function checkAccess(
  file: { type: FileType; path: string },
  p: AccessPredicate,
  variant: AccessVariant = 'access',
): boolean {
  // Type gate — the type must be permitted by at least one grant.
  if (!p.grants.some(g => typeAllowed(file.type, g.allowedTypes))) return false;
  if (variant === 'ui' && !typeAllowed(file.type, p.viewTypes)) return false;

  // Mode isolation — applies to every principal, including admins.
  const modePrefix = `/${p.mode}`;
  if (!(file.path === modePrefix || file.path.startsWith(modePrefix + '/'))) return false;

  if (p.admin) return true;

  // Embedded assets skip path scoping (they travel with their container).
  if (variant === 'embedded') return true;

  // Path: OR across grants of (this grant permits the type AND covers the path),
  // then the ancestor-context special case.
  for (const g of p.grants) {
    if (!typeAllowed(file.type, g.allowedTypes)) continue;
    for (const s of g.scopes) {
      if (scopeMatches(file.path, s, p.mode)) return true;
    }
  }
  return isAncestorContext(file.type, file.path, p.homeFolder);
}

/**
 * Can this principal WRITE (create/edit/delete) a file of `type` at `path` via
 * a GROUP grant? Additive: base users get `false` here (their write rights come
 * from the existing role + home-folder checks); a group grant answers true when
 * its `createTypes` include the type AND a scope covers the path. Universal
 * guards (blocklists, protected paths, location restrictions) are enforced by
 * the caller and are NOT bypassed by this.
 */
export function checkWriteAccess(
  file: { type: FileType; path: string },
  p: AccessPredicate,
): boolean {
  const modePrefix = `/${p.mode}`;
  if (!(file.path === modePrefix || file.path.startsWith(modePrefix + '/'))) return false;
  if (p.admin) return true;
  for (const g of p.grants) {
    if (!typeAllowed(file.type, g.createTypes ?? [])) continue;
    for (const s of g.scopes) {
      if (scopeMatches(file.path, s, p.mode)) return true;
    }
  }
  return false;
}

/** Does ANY grant permit writing this type somewhere? (pre-path type gate) */
export function grantsAllowWriteType(p: AccessPredicate, type: FileType): boolean {
  return p.grants.some(g => typeAllowed(type, g.createTypes ?? []) && g.scopes.length > 0);
}

// ───────────────────── RLS access context (M1c) ──────────────────────────────

/**
 * Serialize a predicate into the per-transaction `app.access` session variable
 * consumed by the `app_access_allows(path, type, op)` policy function — the
 * third enforcement twin, alongside `checkAccess` and `toSql`. The app resolves
 * WHO can do WHAT (config groups × membership × role rules) and hands the
 * database the result; the policies evaluate it generically, so the DB refuses
 * unauthorized rows/writes no matter what SQL runs as `app_user`.
 *
 * `excludeSystem` scopes are pre-resolved into explicit `exclude` prefix lists
 * so the SQL function needs no app constants. Proven row-for-row identical to
 * `checkAccess` by the RLS parity battery (`__tests__/rls-enforcement.test.ts`).
 */
export function buildAccessContext(p: AccessPredicate, variant: AccessVariant = 'access'): string {
  const sysExclude = HIDDEN_SYSTEM_FOLDERS.map(f => resolvePath(p.mode, f));
  const scope = (s: AccessScope) => ({
    path: s.path,
    raw: !!s.matchRaw,
    exclude: s.excludeSystem ? sysExclude : [],
  });
  return JSON.stringify({
    admin: p.admin,
    mode: p.mode,
    variant,
    viewTypes: p.viewTypes,
    homeFolder: p.homeFolder,
    grants: p.grants.map(g => ({
      types: g.allowedTypes,
      createTypes: g.createTypes ?? [],
      scopes: g.scopes.map(scope),
    })),
    write: {
      createTypes: p.baseWrite?.createTypes ?? [],
      createScopes: (p.baseWrite?.createScopes ?? []).map(scope),
      deleteScopes: (p.baseWrite?.deleteScopes ?? []).map(scope),
    },
  });
}

// ───────────────────────── SQL compilation (M1b) ─────────────────────────────

export interface SqlFragment {
  /** Boolean SQL over the `files` row (parameterized). */
  sql: string;
  /** Positional params for the fragment's `$n` placeholders. */
  params: unknown[];
}

/**
 * Compile the SAME predicate to a parameterized SQL `WHERE` fragment — the
 * enforcement twin of `checkAccess`. Proven row-for-row identical to `checkAccess`
 * by the PGLite parity battery (`__tests__/access-predicate-sql.test.ts`).
 *
 * @param opts.alias      table/alias whose `path`/`type` columns are referenced (default `files`)
 * @param opts.paramOffset number of `$n` placeholders already used by the caller's query
 */
export function toSql(
  p: AccessPredicate,
  variant: AccessVariant = 'access',
  opts: { alias?: string; paramOffset?: number } = {},
): SqlFragment {
  const alias = opts.alias ?? 'files';
  const pathCol = `${alias}.path`;
  const typeCol = `${alias}.type`;
  const offset = opts.paramOffset ?? 0;
  const params: unknown[] = [];
  const ph = (v: unknown) => { params.push(v); return `$${offset + params.length}`; };

  const typeGate = (set: TypeSet) =>
    set === '*' ? 'TRUE' : set.length === 0 ? 'FALSE' : `${typeCol} IN (${set.map(t => ph(t)).join(', ')})`;
  // `path = x OR path LIKE x/%` — prefix with a `/` boundary.
  const underPrefixSql = (path: string) => `(${pathCol} = ${ph(path)} OR ${pathCol} LIKE ${ph(path + '/%')})`;
  // raw `startsWith` (conversation folder) — reproduces the legacy boundary-less match.
  const rawPrefixSql = (path: string) => `${pathCol} LIKE ${ph(path + '%')}`;
  const scopeSql = (s: AccessScope) => {
    if (s.matchRaw) return rawPrefixSql(s.path);
    if (s.excludeSystem) {
      const sys = HIDDEN_SYSTEM_FOLDERS.map(f => underPrefixSql(resolvePath(p.mode, f))).join(' OR ');
      return `(${underPrefixSql(s.path)} AND NOT (${sys}))`;
    }
    return underPrefixSql(s.path);
  };

  // Type gate: the type must be permitted by at least one grant.
  const clauses: string[] = [`(${p.grants.map(g => typeGate(g.allowedTypes)).join(' OR ')})`];
  if (variant === 'ui') clauses.push(typeGate(p.viewTypes));
  clauses.push(underPrefixSql(`/${p.mode}`)); // mode isolation

  if (!p.admin && variant !== 'embedded') {
    const pathBlocks: string[] = [];
    for (const g of p.grants) {
      if (g.scopes.length === 0) continue;
      pathBlocks.push(`(${typeGate(g.allowedTypes)} AND (${g.scopes.map(scopeSql).join(' OR ')}))`);
    }
    if (p.homeFolder) {
      const dir = `regexp_replace(${pathCol}, '/[^/]*$', '')`;
      const home = ph(p.homeFolder);
      pathBlocks.push(`(${typeCol} = 'context' AND (${home} = ${dir} OR ${home} LIKE ${dir} || '/%'))`);
    }
    clauses.push(pathBlocks.length ? `(${pathBlocks.join(' OR ')})` : 'FALSE');
  }

  return { sql: clauses.join(' AND '), params };
}
