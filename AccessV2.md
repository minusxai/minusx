# Access V2 — Groups, Folder Permissions, and SQL-Enforced Access

Status: **feature-complete** (PR #599, CI green). Groups are config-stored (no new tables), additive, and inert until populated — merged behavior is unchanged for existing workspaces until an admin creates a group. Remaining (deliberately deferred): M1c transparent RLS and SQL write-guards (writes are enforced app-side with the same engine).

## Why

Today access has two axes:

- **Role** (`admin` / `editor` / `viewer`) → *what kinds of files* you may touch and how (`rules.json`: allowed / create / view types).
- **`home_folder`** (one relative path per user) → *where*. Non-admins can read/create/delete only under that prefix (plus their own conversations); admins get everything in the mode.

Two gaps:
1. **One folder per user.** No way to give a user access to several areas, or to share an area across a team.
2. **Scope implies write.** If a path is in your scope you can edit and delete in it. There's no way to express the most common arrangement — *many people can view this folder, a few can edit it.*

## The model (as shipped)

**Every user has ≥ 1 group: their built-in group (the `role` column) plus any custom groups. No new tables.**

- **Built-in groups** = the roles, fixed identities:
  - `admin` — full access + workspace-admin actions; **locked** (capabilities immune to config overrides — lockout guard) and the **last admin can't be demoted or deleted**.
  - `editor` / `viewer` — base capabilities applied to the member's home folder; their type matrices are **editable** in Settings → Groups → Built-in roles (persisted as the config document's `accessRules` overrides — the UI form of hand-editing that JSON).
- **Custom groups** = capabilities × folders, purely additive:
  - **Definition** lives in the org **config document's `groups` section** (`GroupDef`: `allowedTypes` / `viewTypes` / `createTypes` / `folders`) — next to `accessRules`, hand-editable, versioned with the config, validated on save (`validateGroupsSection`). Reserved names (`admin`/`editor`/`viewer`) are rejected.
  - **Membership** is the `groups` array of names on the **users table** (one idempotent JSONB column — the only schema change). Names are immutable (no rename); a group **cannot be deleted while assigned** to any user; membership names not present in the mode's config are ignored (dangling-safe).
  - **Capability presets** in the UI: `Can view` / `Can build` / `Full access` (which type sets a group gets); `createTypes` is what authorizes **writes** inside the group's folders.
  - **Folder scopes** cascade to subfolders (prefix match), stored mode-relative, resolved per mode — a group defined in org config grants nothing in tutorial mode.
- **`home_folder` stays** a per-user attribute and personal space — the built-in group's capabilities apply there. The group system is additive on top.

**Effective access = union across a user's groups of `(capability ∩ scope)`, plus intrinsic grants (home folder, own conversations).**

- The **per-group intersection** is load-bearing: a user in `Viewer` (read-only) plus `Finance-Editors` (edit on `/finance`) edits in finance and only views elsewhere — a *global* union of capabilities would wrongly grant edit everywhere.
- **Union only — no deny rules.** Most-permissive grant wins. Deny/precedence is where permission systems become unexplainable.
- "Many view, few edit" = two groups over the same folder (`Finance-Viewers`, `Finance-Editors`). The group name *is* the permission. (Mixed levels within one group is deferred — an additive change if ever needed.)

**Workspace-admin actions** (LLM settings, DB import/export, user management — the ~26 admin-only endpoints) are **not** file access. They stay a coarse in-endpoint `isAdmin` check read from the token, exactly as before. **Token/session are unchanged** — nobody is logged out by this feature; custom-group grants are resolved live from the DB+config per request, so membership and definition changes apply on the next request with no re-login. (Only a role change still requires re-login, as before.)

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

### Transparent enforcement via RLS — deferred (M1c), feasibility proven

NOT implemented yet — deliberately sequenced after the feature. The plan, verified empirically on **both PGLite and Postgres**: install the same predicate as a Row-Level-Security policy on `files` (non-superuser `app_user` role + per-transaction session variable + `FORCE ROW LEVEL SECURITY`), so the database itself refuses unauthorized rows regardless of the SQL a caller runs. A narrow owner-run system path stays for migrations/seeding/bootstrap. Footgun when implementing: superusers bypass RLS entirely — the app-vs-system role boundary is the whole game.

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

### M1b — SQL enforcement (zero behavior change) ✅ DONE (except deferred write-guard SQL)
- [x] `AccessPredicate.toSql()` → parameterized `WHERE` fragment (`lib/auth/access-predicate.ts`)
- [x] **Gold parity: compiled SQL selects EXACTLY the `checkAccess`-accepted rows** — PGLite battery `access-predicate-sql.test.ts` (all principals × variants, incl. multi-grant) + real-DB `listall-access.test.ts`
- [x] Optional predicate on `DocumentDB.listAll` (SQL-filtered reads), backward-compatible, param-offset-safe
- [x] Live-wired, group-aware read surface: `getFiles` listings (SQL predicate + in-memory backstop), `loadFile`/`loadFiles` + reference variants, **search**, story previews
- [ ] Write-guard SQL (`INSERT … SELECT … WHERE`, predicate in `UPDATE`/`DELETE` `WHERE`) — deferred hardening; writes are enforced app-side with the same engine (`checkWriteAccess`)
- [x] `path` prefix index — NOTE: `text_pattern_ops` rejected by PGLite (OSS default); hosted-Postgres perf optimization added out-of-band (correctness unaffected)

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
- [x] Group CRUD API (`/api/groups`, `/api/groups/[name]` — name-keyed, no ids) — admin-gated, validated
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

## Test coverage — auth feature classes (all green; proven non-decoration by mutation checks)
Mutation-verified: deleting the system-folder exclusion in `checkAccess` turned **6 tests red** (characterization + SQL parity); reverting the search fix turned its test red. These batteries catch real over-grant regressions.
- **Engine parity** (`lib/auth/__tests__/access-predicate.test.ts`) — `checkAccess` vs frozen legacy `permissions.ts`: full matrix of {admin, editor, viewer} × {home / system-exclusion / database / conversations-raw / runs / ancestor-context / mode-isolation / wrong-mode} × {access / ui / embedded} + config overrides + **admin override-immunity** (lockout guard).
- **SQL parity** (`lib/auth/__tests__/access-predicate-sql.test.ts`) — compiled `toSql` selects EXACTLY the `checkAccess` set against real PGLite, for base **and multi-grant** predicates (union, per-grant type ∩ scope, empty scope, param offset).
- **listAll integration** (`lib/database/__tests__/listall-access.test.ts`) — the predicate SQL-filters a real seeded DB identically to `checkAccess`, composing with type filters.
- **Groups** (`lib/data/__tests__/groups.test.ts`, red-first) — base-only default, additive grant + revert, **3-group union with cross-grant-leak negatives**, **nested overlapping scopes**, mode-scoping, **delete-in-use refusal**, reserved built-in names, duplicate rejection, **dangling membership ignored**, membership round-trip on the users table, guests excluded, **search integration** (member sees, non-member doesn't), config-section + API-payload validation.
- **Group WRITE** (`lib/data/__tests__/groups-write.test.ts`, red-first, through the real `FilesAPI`) — Build-group create/edit/delete in scope; View-group reads but all writes rejected; non-member unchanged; universal guards (config blocklist) not bypassable; scope-bounded.
- **Lockout guards** (`lib/database/__tests__/user-admin-invariant.test.ts`) — last admin can't be demoted or deleted; allowed when another admin exists.
- **Explainability** (`lib/data/__tests__/access-report.test.ts`) — folder→who (admins / home users / groups with view-vs-build) and user→why agree with enforcement.
- **Role editor API** (`app/api/access-rules/__tests__`) — effective matrix, editor/viewer overrides persist, **admin overrides refused**, non-admin forbidden.
- **Legacy** (`lib-unit.test.ts`) — pre-existing `canAccessFile`/`checkFileAccess` characterization still passes through the delegation.

Guests: no user row → no memberships → base-only by construction (tested); public sharing unbroken. Impersonation resolves grants by the impersonated principal's userId (tested).

## Indexing

Prefix matching (`path LIKE '/x/%'`) wants a `text_pattern_ops` index on `path` on hosted Postgres — a plain btree does not accelerate LIKE-prefix under the default collation. **PGLite (the OSS default) rejects that opclass**, and `postgres-schema.ts` runs on both, so the index is NOT in the shared schema; hosted deployments add it out-of-band. Pure perf optimization — correctness is unaffected.
