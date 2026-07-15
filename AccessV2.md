# Access V2 — Groups, Folder Permissions, and SQL-Enforced Access

Status: **in progress** (PR #599). **M1a done + M1b core done**, both proven and zero-behavior-change (CI green). **M2 (groups) and M3 (feature + UI) not yet started** — those are the behavior-changing parts that warrant review before a production flip. See the Milestones section for exact checkbox state.

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

All **file access** is enforced in the query, not in application code. The scattered JS checks (`canAccessFile` and its call sites) are deleted; the permission decision becomes a single SQL predicate over `(files.type, files.path)` and the caller's live group set:

```
admin                                                            -- OR
OR ( path LIKE '/<mode>/%'                                       -- mode isolation
     AND EXISTS ( SELECT 1 FROM group_members m JOIN groups g …  -- union of groups
                  WHERE m.user_id = <caller>
                    AND files.type = ANY(g.types)                --   capability ∩
                    AND (files.path = g.folder
                         OR files.path LIKE g.folder||'/%') ) )  --   scope (prefix)
OR path LIKE '/<mode>/…/<caller home or conversations>/%'        -- intrinsic grants
```

Every operation compiles; "0 rows" = denied:
- **Read / edit / delete** — predicate in `WHERE`.
- **Create** — `INSERT … SELECT <values> WHERE <predicate over the new path+type>`; nothing selected → nothing inserted → denied.
- **Move** — one `WHERE` checks the old path (row) and new path (param) together.

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

### M2 — Group model + resolver (additive — NO migration needed) ✅ DONE
Key correction: **no data migration.** `initializeSchema()` applies the schema idempotently on every boot (both PGLite + Postgres), so new tables are created everywhere automatically; and role + home-folder stay as the base, with groups purely additive on top — behavior is unchanged until a group has members.
- [x] Schema: `groups`, `group_scopes`, `group_members` — additive `CREATE TABLE IF NOT EXISTS` in `postgres-schema.ts`
- [x] `groups.server.ts`: `Group` type, CRUD, `resolveUserGroupGrants(userId, mode)`
- [x] `resolveAccessPredicateWithGroups` — base grant (role+home) ∪ group grants; read paths (`loadFile`/`loadFiles`/`getFiles`) group-aware
- [x] Verified: groups extend access end-to-end; **no members → today's behavior**; mode-scoped; multi-group union; full suite green
- [ ] Seed `Admin`/`Editor`/`Viewer` group ROWS from `rules.json` — deferred (role is the implicit base grant; the group rows are only needed to make them editable in the UI)

### M3 — Feature: custom groups + UX — backend + core UI DONE; two views remain
Backend
- [x] Group CRUD API (`/api/groups`, `/api/groups/[id]`) — admin-gated, validated
- [x] Capability presets (View / Build / Full) — advanced type-matrix override deferred
- [ ] Invariants: **≥ 1 admin** not yet enforced; `Admin` locked ✅ (tested); a group needs ≥ 1 scope ✅ (empty grant is a no-op)

UI
- [x] Group page — members · preset · folder rows (Settings → Groups) — **browser-verified**: create persists + displays after clean boot
- [ ] Folder → access view ("who can see this folder") — NOT done
- [ ] "Why does X have access?" affordance on a user — NOT done
- [ ] User create/edit: assign group(s) — NOT done (membership is edited from the group page)
- [x] Browser-verify — done; visual polish still wants your eye

### Cross-cutting
- [x] Guest / public-share: guests have no memberships → base-only (explicit test); public sharing unbroken (full suite green)
- [ ] Impersonation (`as_user`): resolves by the impersonated user's id — inherits group-aware resolution; no dedicated test yet
- [ ] User-facing permissions doc — NOT done

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

Prefix matching (`path LIKE '/x/%'`) needs a `text_pattern_ops` index on `path` — the existing plain btree (`idx_files_path`) does **not** accelerate `LIKE 'prefix%'` under the default collation. Declared in `postgres-schema.ts` as `CREATE INDEX IF NOT EXISTS … (path text_pattern_ops)` (self-applies on boot) + `npm run update-workspace-template`.
