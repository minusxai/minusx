# Access V2 — Groups, Folder Permissions, and SQL-Enforced Access

Status: **feature-complete** (PR #599). M1a + M1b core + M2 + M3 (read AND write sharing, roles editor, access explorer) are done, tested, and CI-green. Groups are inert until populated, so merged behavior is unchanged for existing workspaces. Remaining (deliberate): M1c transparent RLS (optional hardening) and SQL write-guards (app-side checks enforce writes today).

## Why

Today access has two axes:

- **Role** (`admin` / `editor` / `viewer`) → *what kinds of files* you may touch and how (`rules.json`: allowed / create / view types).
- **`home_folder`** (one relative path per user) → *where*. Non-admins can read/create/delete only under that prefix (plus their own conversations); admins get everything in the mode.

Two gaps:
1. **One folder per user.** No way to give a user access to several areas, or to share an area across a team.
2. **Scope implies write.** If a path is in your scope you can edit and delete in it. There's no way to express the most common arrangement — *many people can view this folder, a few can edit it.*

## The model

**Roles become groups. Add groups. Keep the home folder.**

- A **group** = a **capability profile** + a set of **folder scopes** + members.
  - **Capability profile** — the type/verb matrix (today's `rules.json` shape). Chosen from a **preset**: `View` (read-only types), `Build` (create/edit analytics types), `Full` (build + manage connections/contexts + delete). The raw matrix is an "advanced" escape hatch.
  - **Folder scopes** — a list of folders the profile applies to. Grants **cascade to subfolders** (prefix match). Stored mode-relative (like `home_folder`), resolved per mode at runtime.
  - Membership is plain — a group's meaning lives in the group, not the membership.
- **Seed groups** map 1:1 from today's roles, so migration is behavior-identical:
  - `Admin` — a **special, locked group**: capabilities `*`, scope `*`, plus workspace-admin (below). Only membership is editable.
  - `Editor` — today's editor types, scope = the member's home folder.
  - `Viewer` — today's viewer types, scope = the member's home folder.
- **`home_folder` stays** a per-user attribute and personal space. Internally it's an intrinsic grant (`Editor`/`Viewer` reference it as a symbolic scope); the group system is purely additive on top.

**Effective access = union across a user's groups of `(capability ∩ scope)`, plus intrinsic grants (home folder, own conversations).**

- The **per-group intersection** is load-bearing: a user in `Viewer` (read-only) plus `Finance-Editors` (edit on `/finance`) edits in finance and only views elsewhere — a *global* union of capabilities would wrongly grant edit everywhere.
- **Union only — no deny rules.** Most-permissive grant wins. Deny/precedence is where permission systems become unexplainable.
- "Many view, few edit" = two groups over the same folder (`Finance-Viewers`, `Finance-Editors`). The group name *is* the permission. (Mixed levels within one group is deferred — an additive change if ever needed.)

**Workspace-admin actions** (LLM settings, DB import/export, user management — the ~26 admin-only endpoints) are **not** file access. They stay a coarse in-endpoint check (`is the user in an admin-capable group?`), read from the token like `role` is today. Only the fine-grained folder scopes are resolved live (below).

## Enforcement — compiled to SQL

**File reads** are enforced in the query: the permission decision compiles to a single SQL predicate over `(files.type, files.path)` and the caller's live group set. The in-memory `checkAccess` (same engine, proven identical) remains as the per-file guard and defense-in-depth backstop. **Writes are checked app-side** with the same engine (where the group state and the precise error message live); pushing write guards into the SQL `WHERE` is optional hardening:

```
admin                                                            -- OR
OR ( path LIKE '/<mode>/%'                                       -- mode isolation
     AND ( files.type IN (<grant types>)                         -- per resolved grant:
           AND (files.path = <grant folder>                      --   capability ∩
                OR files.path LIKE <grant folder>||'/%') ) )     --   scope (prefix), OR'd
OR path LIKE '/<mode>/…/<caller home or conversations>/%'        -- intrinsic grants

Grants are resolved in the app (config `groups` section × the caller's
membership array) and compiled into the WHERE as literals — the query never
joins any table.
```

Every operation is *compilable* ("0 rows" = denied) — reads are wired to SQL today; write-guard SQL (`INSERT … SELECT … WHERE`, predicate in `UPDATE`/`DELETE` `WHERE`) is deliberately deferred hardening.

Fine-grained scopes are a **live join** in the query (not the token), so adding a user to a group, or a folder to a group, takes effect immediately — no re-login. (The coarse admin flag can live in the token, like `role` today.)

### Transparent enforcement via RLS

The same predicate is installed as a **Postgres Row-Level Security policy** on `files`, so the database itself refuses unauthorized rows regardless of the SQL a caller runs — defense in depth, and enforcement can't be forgotten.

- **Verified to work on both PGLite and Postgres** (the two backends this app supports). Mechanism: a non-superuser `app_user` role + a per-transaction session variable carrying the caller's identity/scope + `FORCE ROW LEVEL SECURITY`. Tested: a caller sees exactly the rows their group capability × folder scope allow.
- **A narrow system path** (running as the owner, RLS bypassed) is reserved for migrations, seeding, and first-user bootstrap (there are no groups yet when the first admin registers).
- **Footgun to respect:** superusers bypass RLS entirely. So exactly one narrow system path runs as the owner; everything else goes through the `app_user` wrapper. That boundary is the whole game.

### Two reference variants (preserve today's behavior)

Reference resolution already has two variants that the SQL must keep:
- **Folder children** → full predicate (type + mode + **path**).
- **Embedded assets** (e.g. the questions inside a dashboard you can open) → **type + mode only, no path scope** — they travel with their container. Applying the path predicate here would wrongly hide them.

So the by-id read carries *which variant* the caller needs (today's `file.type === 'folder'` branch, pushed down a layer).

## Milestones

Each milestone is gated by tests. **No behavior change until M3.** RLS (M1c) is optional hardening, sequenced *after* the feature works — it doesn't block anything before it.

### M1a — Resolver + predicate parity (zero behavior change) ✅ DONE (PR #599)
Extract one effective-access resolver producing an `AccessPredicate` + in-memory `check()` that reproduces **today's exact behavior**, then route the existing gate through it.
- [x] `AccessPredicate` contract + `resolveAccessPredicate(user)` + `checkAccess(file, predicate, variant)` — `lib/auth/access-predicate.ts` + `access-resolver.ts`
- [x] Reproduce `canAccessFile`: type access (role + config `accessRules` overrides), mode isolation, admin bypass
- [x] Reproduce non-admin path rules: home folder (excluding system subfolders), `/database`, own `/logs/conversations/{id}`, `/logs/runs`, ancestor-context access
- [x] Reproduce the two reference variants (folder-child = full; embedded asset = type + mode only)
- [x] Reproduce `canViewFileInUI` (adds `viewTypes`) — differential battery. *(Write rules — create/edit/delete — stay app-side by design, per the Q1 decision: app-side check for the error message; SQL scope-guard added in M1b live-wiring.)*
- [x] Characterization battery ({admin, editor, viewer, guest-shaped, impersonation-shaped} × path/type/variant matrix) — `__tests__/access-predicate.test.ts`
- [x] Route `permissions.ts` (`canAccessFile`/`canViewFileInUI` delegate) + `files.server.ts` reference filter through the engine; deleted duplicated helpers; full suite + `validate` green

### M1b — SQL enforcement (zero behavior change) — CORE DONE (PR #599); live-wiring in progress
- [x] `AccessPredicate.toSql()` → parameterized `WHERE` fragment (`lib/auth/access-predicate.ts`)
- [x] **Gold parity: compiled SQL selects EXACTLY the `checkAccess`-accepted rows** — PGLite battery `__tests__/access-predicate-sql.test.ts` (all principals × variants) + real-DB `listAll` integration `__tests__/listall-access.test.ts`
- [x] Optional predicate on `DocumentDB.listAll` (SQL-filtered reads), backward-compatible, param-offset-safe
- [ ] **Live-wiring (needs review — flips user-facing reads):** pass the predicate from `readFolder`/`file-search`/`shares` read paths; carry the variant into `getByIds` for references
- [ ] Guarded writes: predicate in `WHERE` for edit/delete/move; `INSERT … SELECT … WHERE` for create (app-side check retained for the error message)
- [x] `path` prefix index — NOTE: `text_pattern_ops` rejected by PGLite (OSS default); it's a hosted-Postgres-only perf optimization added out-of-band (correctness unaffected)

### M1c — Transparent RLS *(optional hardening — gated on the timing decision)*
- [ ] Non-superuser `app_user` role + `GRANT`s (`postgres-schema.ts`)
- [ ] Per-transaction `SET LOCAL ROLE` + caller session var in the DB module
- [ ] Narrow system-bypass path (migrations, seeding, first-user bootstrap)
- [ ] Install the predicate as an RLS policy + `FORCE ROW LEVEL SECURITY`; verify on PGLite **and** Postgres; test the superuser-bypass boundary

### M2 — Group model + resolver (additive — NO migration, NO new tables) ✅ DONE
**Storage (final):** group DEFINITIONS live in the org config document's `groups` section (name → capabilities × folders), next to `accessRules` — hand-editable and versioned with the config. MEMBERSHIP is a `groups` array of names on the users table (one idempotent column; the only schema touch). The built-in groups ARE the roles: the `role` column is the user's built-in group (admin locked; editor/viewer capabilities editable via `accessRules`) — so every user has ≥1 group, and custom groups are purely additive.
- [x] `OrgConfig.groups` (`GroupDef`) + `validateGroupsSection` (reserved built-in names rejected) + `mergeConfig` carry-through
- [x] `users.groups` JSONB column (idempotent `ADD COLUMN IF NOT EXISTS`); `UserDB` round-trips it
- [x] `groups.server.ts`: config-backed CRUD (names immutable; **delete refused while assigned**; dangling membership names ignored), `resolveUserGroupGrants`
- [x] `resolveAccessPredicateWithGroups` — base grant (built-in group + home) ∪ custom-group grants; read paths group-aware
- [x] Verified red-first: additive; no membership → today's behavior; mode-scoped; **3-group union**; **nested overlapping scopes**; guests excluded; full suite green

### M3 — Feature: custom groups + UX ✅ DONE
Backend
- [x] Group CRUD API (`/api/groups`, `/api/groups/[id]`) — admin-gated, validated
- [x] **Group WRITE access** — `createTypes` grants authorize create/edit/delete within group scopes (red-first tested; universal guards not bypassable)
- [x] Group-aware read surface complete: loads, listings, **search**, story previews
- [x] Capability presets (View / Build / Full); built-in-roles matrix editor covers the advanced case
- [x] Invariants: **≥ 1 admin** (last admin can't be demoted/deleted — data-layer, tested); admin capabilities immune to `accessRules` overrides (lockout guard, tested); `Admin` group locked (tested); empty-scope grant is a no-op (tested)

UI (Settings → Groups; browser-verified)
- [x] Group page — members · preset · folder rows
- [x] **Built-in roles** — effective capability matrix per role; editor/viewer editable (writes config `accessRules`); admin locked
- [x] **Access explorer** — folder → who (with view/build level), user → why (role / home / each group)
- [x] Membership editing (from the group page; a per-user assign affordance on the Users page is a nice-to-have)
- [x] Browser-verify — done; visual polish still wants your eye

### Cross-cutting ✅ DONE
- [x] Guest / public-share: guests have no memberships → base-only (explicit test); public sharing unbroken (full suite green)
- [x] Impersonation: grants resolve by the impersonated principal's userId (tested)
- [x] User-facing permissions doc — `docs/content/docs/self-hosting/permissions.mdx`

## Test coverage — auth feature classes (all green; proven non-decoration by a mutation check)
The batteries were verified meaningful by deleting the system-folder exclusion in `checkAccess` and confirming **6 tests went red** across the characterization + SQL parity, then reverting.
- **Engine parity** (`access-predicate.test.ts`) — `checkAccess` vs frozen legacy `permissions.ts`, full matrix of {admin, editor, viewer} × {home / system / database / conversations-raw / runs / ancestor-context / mode-isolation / wrong-mode} × {access / ui / embedded} + config overrides.
- **SQL parity** (`access-predicate-sql.test.ts`) — compiled `toSql` selects EXACTLY the `checkAccess` set against real PGLite, for base predicates **and multi-grant (group) predicates** (union, per-grant type ∩ scope, empty scope, param offset).
- **listAll integration** (`listall-access.test.ts`) — the predicate SQL-filters a real seeded DB identically to `checkAccess`.
- **Groups** (`groups.test.ts`) — additive grant, capability-limited, removal reverts, **mode-scoped**, **multi-group union**, **locked** reject, **guest** base-only, CRUD round-trip, `validateGroupInput`.
- **Legacy** (`lib-unit.test.ts`) — the pre-existing `canAccessFile`/`checkFileAccess` characterization tests still pass through the delegation.

## Test strategy (Phase 1 is a security change — coverage is the safety)

Parity battery = **principals** {user, admin, **guest**, impersonated} × **variants** {folder-child, embedded-ref, conversation-folder, mode-isolation, create-blocklist}. Guest especially: guests have no group memberships, so the predicate must be **optional** (guests are covered only by their intrinsic scope) or public sharing breaks. Invariants: always ≥1 admin-capable member; the `Admin` group can't be edited into a lockout.

## Indexing

Prefix matching (`path LIKE '/x/%'`) wants a `text_pattern_ops` index on `path` on hosted Postgres — a plain btree does not accelerate LIKE-prefix under the default collation. **PGLite (the OSS default) rejects that opclass**, and `postgres-schema.ts` runs on both, so the index is NOT in the shared schema; hosted deployments add it out-of-band. Pure perf optimization — correctness is unaffected.
