# Storage and the data layer

Everything that persists, across four directories: **`lib/database`** (schema-as-data, the
PGLite/Postgres adapters, migrations, the data-version gate), **`lib/data`** (the `FilesAPI` dual
client/server data layer and its loader pipeline), **`lib/object-store`** (blobs) and
**`lib/secrets`** (the credential boundary). This is the DOCUMENT plane — analytics connectors are
`frontend/lib/connections/`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## Module ownership

**`lib/modules/`** — the process-wide capability registry. `ModuleSet` = `{ auth, db, store, cache,
namespace }`, stashed on `global.__minusx_modules__` (not a module-level `let`: Turbopack evaluates the
instrumentation bundle separately from request-handler bundles, and two PGLite instances on one data
directory corrupt the wire protocol). `lib/instrumentation/register-modules.ts` builds the set —
`DBModule` (PGLite) or `AdapterBackedDBModule` (Postgres) chosen by `getDbType()` — then calls
`db.init()` and `runBootTasks()`. The boot tasks (the unhandled-rejection router, the chat runtime
warm) live there rather than in `frontend/instrumentation.ts` because that file returns early for a
deployment supplying its own module set: anything after the branch had to be re-implemented verbatim,
and silently missed whatever was added later. Tests register their own set in
`test/setup/vitest.setup.ts`. Three slots carry the traffic — counting non-test call sites,
`getModules().db` has 81, `.namespace` 19, `.auth` 6 — while `.store` and `.cache` have none:
`ObjectStoreModule` exists only to satisfy the `ModuleSet` type and every method throws except
`resolvePath` (which returns the key unchanged), `InMemoryCacheModule` is dead code, and
object-store callers go through `lib/object-store/index.ts` directly.

**`lib/database/`** — SQL and schema. `documents-db.ts` (`DocumentDB`) is the only SQL surface for the
`files` table; `user-db.ts` for `users`; `job-runs-db.ts` for `job_runs`; `config-store.ts` for the
version stamps (`schema_version` in `configs`, `data_version` in `public_data` — see Migrations).
The DDL is still one idempotent string —
tables, partial indexes, triggers, and `ALTER … IF NOT EXISTS` self-heal guards, replayed on every
boot by both adapters — but it is now *generated*: `postgres-schema.ts` is only
`renderSchema(TABLES, { schemaName })`. It does **not** own row-level access control (that
is `lib/data/helpers/permissions.ts`) and it does **not** own analytics query logic (only the analytics
table definitions live here; queries are in `lib/analytics/`).
`lib/database/duckdb.ts` is unrelated to the document DB: it is a browser DuckDB-WASM helper used by
`components/plotx/TableV2.tsx` for column stats and by `lib/chart/histogram.ts`.

**`lib/database/schema/`** — the schema, declared as data rather than as SQL text. `schema/tables.ts`
declares all 16 tables as typed `Table` objects: columns, primary key, uniques, partial and
expression indexes, and a `touchUpdatedAt` flag standing in for the four identical `updated_at`
triggers. `schema/render.ts` turns that into the DDL string. The point is that a deployment needing a
*variant* maps over the declaration instead of restating every table — two copies of a schema drift,
and `IF NOT EXISTS` hides the drift because it matches on NAME rather than definition.
`schema/types.ts` deliberately offers **no raw-SQL escape hatch**: anything held as an opaque string
is invisible to a consumer that rewrites the schema, so it can neither be transformed nor checked.
When something cannot be expressed, widen `ColumnType` or `IndexColumn` rather than smuggling a
string through — the one expression index in the real schema (`(meta -> 'shares') jsonb_path_ops`) is
first-class for exactly this reason. Every column is emitted twice, once inside
`CREATE TABLE IF NOT EXISTS` and once as `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so a database
built from an older declaration gains newly-declared columns on the next boot with no migration step.

**`lib/namespace/types.ts`** — the prefixes that keep one workspace's effects out of another's. The
*seam* (`INamespaceModule` in `lib/modules/types.ts`) belongs to `frontend/lib/auth/CLAUDE.md`; the
three verbs that matter to storage are `isolation()` (the prefix every durable key carries),
`minDataVersion()` (the oldest data version across every namespace, which is what makes raising
`MINIMUM_SUPPORTED_DATA_VERSION` checkable before a deploy) and `provision()` (create + seed a
namespace). What this file owns is the string algebra. A `Namespace` is three already-joined levels,
coarse to fine: `isolation`, `mode` (`isolation` +
`org`/`tutorial`/`internals`), and `user` (`mode` + the user id). Call sites name the level they
want and never concatenate, which is the whole point — a deployment that inserts a coarser level
ahead of `mode` changes no consumer, because no consumer builds a path. `namespaced()` does the
join, stripping a leading `/` so a stray separator cannot silently re-root a store;
`namespacedChannel()` does the identifier-safe join for LISTEN/NOTIFY, scrubbing `[^a-zA-Z0-9_]` and
prefixing `ns` because a channel name is a SQL identifier and a numeric isolation value would emit
`1_conv_7`, which Postgres reads as a malformed numeric literal — `LISTEN` throws and the stream
silently never subscribes. `DEFAULT_ISOLATION` is `'mx'` and is non-empty on purpose: an empty root
would emit a leading separator on every key, so every call site would need its own emptiness check.
It is pure string algebra and performs no I/O; the *value* of `isolation` comes from
`getModules().namespace`.

**`lib/data/`** — the data layer proper. `files.server.ts` / `files.ts` are the two `IFilesDataLayer`
implementations; `connections.server.ts`, `configs.server.ts`, `shares/shares.server.ts`,
`conversations.server.ts`, `completions/completions.server.ts`, `remote-sessions.server.ts` are
siblings for non-file-shaped concerns. `loaders/` holds per-type read-time transforms; `helpers/`
holds the pure predicates they and `files.server.ts` share (`permissions.ts`, `references.ts`,
`connections.ts`, `prune-connection-schema.ts`, `param-resolution.ts`); `story/` holds the story
markup codec, the server-side CSS compile and the theme/template registries (documented in
`frontend/lib/story-ui/CLAUDE.md`). `conversation-log.ts` /
`conversation-projection.ts` shape chat rows for the wire and are documented with chat. It owns
*what a file means on read and write*; it does not own SQL string construction (that is
`DocumentDB`) nor HTTP shapes (that is `app/api/files/**`).

**`lib/object-store/`** — binary blobs. `createObjectStore()` is **async** and always returns a
`NamespacedObjectStore` (`namespaced.ts`) wrapping `S3Adapter` when both `OBJECT_STORE_BUCKET` and
`OBJECT_STORE_ACCESS_KEY_ID` are set, else `LocalFsAdapter`
(`LOCAL_UPLOAD_PATH/{key}`, served through auth-gated routes under `app/api/object-store/`). The
namespace prefix is applied at the **factory**, not behind a module a caller may or may not use: an
earlier attempt put it behind the injectable `getModules().store`, which no call site ever asked for,
so the prefixing silently never happened. Wrapping what everyone already calls is what makes it
unbypassable — `copyObject` prefixes *both* keys, so a copy cannot cross the boundary. There are
deliberately no shared keys: reading a shared prefix would need an exemption from the prefix, and an
exemption is the hole. The mxfood sample data is not stored here at all — the tutorial connection's
`dataset` entries are read from a published source URL by the CSV connector directly
(`lib/connections/csv-connector.ts`), which never goes through the store. It stores
uploads, chart images, CSV/Parquet warehouse files, and — via
`lib/query-cache/blob-store.ts` — every cached query result blob. It does not know about files rows.

**`lib/secrets/`** — the credential boundary. Raw credentials never live in a `files` row: they are
extracted on write into the server-only `secrets` table (`path TEXT PRIMARY KEY, value TEXT`) and the
document keeps a self-describing `@SECRETS/…` reference. `secret-refs.ts` and `config-secret-specs.ts`
are deliberately **not** `server-only` (pure string/object logic so the client can render "•••• (saved)");
`*.server.ts` files hold everything that can read a value.

A `ConfigSecretSpec`'s `arrayPath` targets either an array of objects (`bots`, `llm.providers`) or a
**single** object (`gateway`), and only ONE of the two walks handles the single case.
`extractConfigSecrets` normalises it to a one-element list; `redactRawConfigSecrets` and
`restoreRedactedConfigSecrets` go through `mapConfigSecrets` → `secretArrayAt`, which returns `null`
for anything that is not an array and therefore skips single-object specs entirely. Extraction
normally makes that moot — the value is a `@SECRETS/…` ref before anything reads it — but a *raw*
`gateway.orgSecret` is neither masked on a client-facing read nor restored after a placeholder
round-trip. Adding a single-object spec means fixing `secretArrayAt`, not just the spec list.

## Architecture

```
browser                        server
─────────                      ──────────────────────────────────────────────
lib/file-state/*  ──HTTP──►  app/api/files/**  ──►  FilesAPI (files.server.ts)
  (FilesAPI, lib/data/files.ts)                          │
                                                         ├─ canAccessFile()  helpers/permissions.ts
                                                         ├─ getLoader(type)  loaders/registry.ts
                                                         └─ DocumentDB       lib/database/documents-db.ts
                                                                 │
                                                        getModules().db.exec()
                                                                 │
                                              PgliteAdapter  ──or──  PostgresAdapter
```

**FilesAPI dual implementation.** `files.interface.ts` is the contract. The client
(`lib/data/files.ts`) is pure `fetch` against `/api/files*` and deserializes typed errors
(`ConflictError`, `FileExistsError`, `AccessPermissionError`). The server (`files.server.ts`) is the
only place permission checks, save gates, and secret extraction happen. Two methods deliberately
break the symmetry: `appendJsonArray` throws on the client (server-only JSONB append with optimistic
length check), and `getRubric` exists only on the client (the server computes rubrics directly via
`lib/rubric/score-file.server.ts`).

**The read pipeline.**

```
loadFile(id)
  DocumentDB.getById            → row (content included)
  canAccessFile                 → 403 or continue
  extractReferenceIds           → cached `file_references` column, or child ids for folders
  DocumentDB.getByIds(refIds)   → reference rows WITH content
  filter refs                   → folder parent ⇒ full canAccessFile
                                  content parent ⇒ type access + mode prefix only
  getLoader(type)(file)         → connection | context | config | story | pass-through
  getLoader(refType)(ref)       → same, per reference
```

`getFiles` runs the *same* `getLoader(file.type)` call over every row it returns — but it fetches
those rows with `DocumentDB.listAll(type, paths, depth, /* includeContent */ false)`, so
`rowToDbFile` sets `content: null` and **all four custom loaders early-return on null content**. The
loader fan-out therefore costs nothing on a listing. That is a per-loader convention with no
enforcement anywhere: a new loader that omits the `content === null` guard silently turns every
folder listing into N schema introspections or N context recomputations.

The expensive fan-out is `loadFile`/`loadFiles`, where references come back with content. Loading a
folder whose children include a connection can block on a first-time warehouse introspection; a
context reference triggers a full `computeSchemaFromWhitelist`. Both loaders carry in-flight
coalescing maps precisely because of this (`inflightRefreshes` keyed by file id in
`connection-loader.ts`; `inflightContextLoads` keyed by `fileId:userId:mode` in `context-loader.ts`),
each with a targeted `no-restricted-syntax` eslint-disable.

`LoaderOptions` (`loaders/types.ts`) carries three flags, and the third is the second way to skip
the fan-out: `refresh` (block on fresh data), `backgroundRefresh` (serve cached, refresh behind),
and `skipEnrichment` (serve the stored content — used by file search, which must not pay a
minutes-long introspection and must not hit the context loader's throw on a version-less document).
`skipEnrichment` deliberately does **not** skip sanitisation: `connectionLoader` still runs
`getSafeConfig` after it, because a redaction that an option can turn off is not a boundary.

**Loaders** (`loaders/registry.ts`, four entries; every other type is `defaultLoader`):
- `connection-loader.ts` — stale-while-revalidate schema cache. Fresh (<24h) cache is served as-is;
  stale or `backgroundRefresh` serves the cache and re-introspects in the background; no schema at
  all blocks on the first introspection; `refresh: true` always blocks. A refresh that returns zero
  schemas over a non-empty cache keeps the cache (a permission-restricted role must not clobber a
  known-good schema). Persists through `ConnectionsAPI.updateCachedSchema`, then redacts the config
  via `getSafeConfig`.
- `context-loader.ts` — resolves the user's published version, computes `fullSchema` / `parentSchema`
  / `fullDocs` / `fullMetrics` / `fullSkills` / `fullAgents` / `fullSemanticModels`, injects views as tables under the
  `_views` schema (fail-closed: a view whose reads are no longer available leaves the schema and is
  reported in `viewProblems`), then bounds the schema (`boundFullSchema` keeps every table but may drop
  columns; `boundSchema` may also cap tables) to stop a multi-thousand-table connection from putting
  megabytes into every response. Non-admins get only their published version back.
- `config-loader.ts` — masks raw credentials in legacy config documents (`redactRawConfigSecrets`).
- `story-loader.ts` — recompiles `compiledCss` when `cssCompileVersion` is stale, without persisting.

**The write pipeline** (`saveFile`, and the shape `createFile` mirrors):

```
canAccessFile → canCreateFileByRole → PROTECTED_FILE_PATHS
  ├ connection: strip client `schema`, mergeExistingSecretRefs, extractConnectionSecrets,
  │             pruneConnectionSchemaToFiles (static CSV/Sheets)
  ├ context:    strip fullSchema/parentSchema/fullDocs/fullSkills/fullAgents, normalise version whitelists
  │             (see the strip-asymmetry gotcha — the loader injects more than this)
  ├ config:     restoreRedactedConfigSecrets → extractConfigSecrets
  └ story:      withCompiledStoryCss (client copy always discarded)
validateFileStateServer            (Ajv against lib/validation/atlas-json-schemas)
context only: stampAndValidateViews + validateSemanticModelsGate  ← THE save gates
reject negative (virtual) reference ids; verify parent folder exists if path changed
DocumentDB.update(…, editId, expectedVersion)
  ├ editId === last_edit_id            → { alreadyApplied }, no write
  ├ expectedVersion mismatch           → { conflict }   → ConflictError(currentFile)
  └ otherwise UPDATE … draft = false   (this is the publish)
publish AppEvents.FILE_UPDATED
connection → reload with backgroundRefresh; context → reload with refresh
```

**Drafts and publishing.** `FilesAPI.createFile` starts a row as `draft = true` unless the type is
structural — `LIVE_ON_CREATE_TYPES` in `files.server.ts`:
`folder, config, styles, context, context_run, alert_run, report_run, session`.
`DocumentDB.listAll` unconditionally ANDs `draft = false`, which is the entire reason agent-created
files stay invisible in the folder browser until the user saves. Path uniqueness is a **partial**
unique index (`idx_files_path_published_unique … WHERE draft = false`), so many drafts may share a
path; `DocumentDB.update` flips `draft = false` and can therefore fail the index, which
`withPathConflictTranslation` turns into a `UserFacingError` telling the user to rename.
`getByPath` orders `draft ASC, updated_at DESC LIMIT 1` so a draft never shadows the published file.

**Migrations.** `schema_version` lives in `configs`; `data_version` lives in **`public_data`**, the
one `scope: 'public'` table — a deployment serving several workspaces has to answer "what is the
oldest version any of them is on?" *before* it knows which workspace a request belongs to, and every
namespace-scoped table is unreadable at that point. `getDataVersion` falls back to the old `configs`
row for workspaces written before the move; `getMinDataVersion` is the aggregate, and passing
`legacyFallback: false` makes it return `0` ("not determinable") rather than answer a different
question with one workspace's row. `LATEST_DATA_VERSION` and `MINIMUM_SUPPORTED_DATA_VERSION` are
in `constants.ts`. Each `MigrationEntry` in `migrations.ts` may declare a whole-DB
`dataMigration` and/or a streaming `rowMigration` (`{ types, migrateContent }`); the two must
produce identical content, because which one runs depends on the caller.

**Boot applies the schema and does not migrate.** `registerWithModules` registers the module set,
calls `db.init()`, and then runs `runBootTasks()` (the unhandled-rejection router, the chat warm) —
no migration anywhere. `runMigrationsIfNeeded` in `run-migrations.ts` has no caller outside tests, so
its row path — keyset-paginated batches of 200, `UPDATE`-in-place, bounded memory — is dormant rather
than preferred. Migrating at boot cannot be made correct for a deployment serving more than one
workspace: there is no request, so no workspace to be in, and every replica races to rewrite the same
rows. `lib/instrumentation/__tests__/boot-does-not-migrate.test.ts` asserts this at the seam — no
migrate call, `init()` still happens, and no `runMigrations` hook exists for a deployment to
implement — rather than by reading the source.

The only production migration path is `POST /api/admin/migrate-db`. It short-circuits when the
stored versions already match the target (unless `{ force: true }`), and otherwise always takes the
**whole-DB** path — `exportDatabase → applyMigrations → validateInitData → atomicImport`, then
stamps both versions. It never uses the row path, so it materialises the entire `files` table in
memory; validation failure aborts before `atomicImport`, leaving the database untouched.

**The data-version gate replaces boot migration.** A build declares the oldest data version it can
READ (`MINIMUM_SUPPORTED_DATA_VERSION`) and the version it WRITES (`LATEST_DATA_VERSION`);
`data-version-gate.ts` refuses anything outside that range **per request**, because a workspace can be
migrated — or a build rolled back — while the process is running. Both bounds fail silently without
it: data below the minimum is *misread* rather than rejected (`upgrade-pending`), and data above the
maximum means an older build is about to write v38 shapes over v39 rows (`build-too-old`). Version
`0` passes: it means neither the `public_data` row nor its `configs` fallback exists yet, i.e. a
workspace mid-provision, and refusing there would break registration itself. `withAuth` turns a failing verdict into a 503 carrying
`code`, and `app/layout.tsx` renders `components/banners/UpgradePendingGate.tsx` instead of the app —
a banner would be decoration when every API call 503s. `build-too-old` gets no Migrate button on
purpose: the fix is redeploying the newer build, not rewriting newer rows with older shapes.

**The one escape.** `POST /api/admin/migrate-db` is wrapped in `withAuthSkippingDataVersionGate`
(`lib/http/with-auth.ts`), a separate named export rather than a flag, so exempting a route is a
visible decision at its definition. Gating the route that CLEARS the gate makes the refusal
unescapable — every request 503s including the fix, and the Migrate button reports the gate's own
message back forever. That shipped, and
`lib/http/__tests__/data-version-gate-escape.test.ts` now pins the pairing from both sides, plus that
skipping the version gate does not skip authentication. Nothing else may use that wrapper: an exempt
route is a route allowed to read data this build may misread.

**Seeding.** `AuthModule.register` reads `lib/database/workspace-template.json` (a static import,
so a dev server must be restarted to pick up template edits), substitutes `{{ORG_NAME}}`,
`{{ADMIN_EMAIL}}`, `{{ADMIN_NAME}}`, `{{ADMIN_PASSWORD_HASH}}`, `{{TIMESTAMP}}`, `{{DEFAULT_STYLES}}`,
runs `applyMigrations`, `atomicImport`s the result, optionally saves a bootstrap LLM
config and creates a first connection. Sample data is not copied anywhere: the tutorial
connection's `dataset` entries are fetched from the published source and materialized by the CSV
connector on first use. After adding a migration, `npm run update-workspace-template`
(`scripts/update-workspace-template.ts`) re-runs migrations over the template.

## Interactions with other areas

| Boundary | Contract |
|---|---|
| `lib/file-state/` → `lib/data/files.ts` | The **only** browser path to files. `file-read.ts`/`file-mutations.ts`/`file-publish.ts` wrap the client `FilesAPI` and add Redux. Components must not `fetch('/api/files')` themselves. |
| `app/api/files/**` → `files.server.ts` | Routes are thin: parse, call `FilesAPI`, `handleApiError`. All authorization is inside the data layer, not the route. |
| Agent tools → `files.server.ts` | Server tools (`ReadFiles`, `EditFile`, health tools in `agents/analyst/health-tools.ts`) and `lib/tools/handlers/*` go through the same `FilesAPI`, so the save gates apply to agent writes identically to browser writes. |
| `lib/views/save-gate.server.ts`, `lib/semantic/save-gate.server.ts` | Called from `saveFile` for `type === 'context'` only. They recompute a view's `reads` from its SQL (never trusting the client) and reject a version that reaches outside the parent knowledge base. `SemanticModelSaveError` carries the problems as an `issues` array (its own `message` joins them with `; `); `saveFile` re-throws as `UserFacingError(err.issues.join('\n'))` because `components/context/SemanticModelsEditor` splits the message back per model on a newline boundary — join them any other way and the editor shows one blob. |
| `lib/connections/` | `connection-loader` calls `getNodeConnector` + `profileDatabase`; `run-query.ts` calls `ConnectionsAPI.getRawByName` then `resolveConnectionSecrets`. Connectors never touch `files` rows. |
| `lib/query-cache/` | Owns the `query_cache` control-plane table (declared in `lib/database/schema/tables.ts`) and stores result blobs through `lib/object-store`. Reads connection metadata via `ConnectionsAPI.getRawByName`, never `FilesAPI.loadFile` — that would drag in schema profiling on the hot path. |
| `lib/analytics/` + `lib/app-event-registry/` | `FilesAPI` publishes `FILE_CREATED` / `FILE_UPDATED` / `FILE_DELETED` / `FILE_VIEWED_AS_REFERENCE` fire-and-forget; `loadFile` merges `getFileAnalyticsSummary` into result metadata and swallows its failures. |
| `lib/auth/` | `EffectiveUser` (role, `home_folder`, `mode`) is an input to every data-layer method. `lib/auth/share-tokens.ts` mints and validates public share links whose records `SharesAPI` writes into `files.meta.shares[]`. |
| `lib/mode/path-resolver` | Mode isolation is a *path prefix* convention (`/org/…`, `/tutorial/…`) enforced in `canAccessFile`; the data layer stores physical paths and resolves relative `home_folder` values at check time. |
| Chat v3 | `conversations` + `messages` are declared in `lib/database/schema/tables.ts` and served by `lib/data/conversations.server.ts`; a conversation id is `MAX(id)` over **both** `files` and `conversations` (floor 1000) + 1, taken under the advisory lock the files allocator uses, so the two share one id-space. Streaming wakeups ride `IDatabaseAdapter.notify/listen`. |
| Scripts | `scripts/heal-stories.ts` → `lib/data/heal-stories.server.ts`; `scripts/migrate-conversations-to-v3.ts` → `lib/data/migrate-conversations-v3.server.ts`. Both check `isModulesRegistered()` first. |
| Admin routes | `app/api/admin/{export-db,import-data,migrate-db,validate-db}` are the only callers of `exportDatabase`/`validateInitData` outside `run-migrations.ts`. `reset-tutorial` is the odd one out: it wipes and re-seeds the `/tutorial` and `/internals` subtrees from `workspace-template.json` + `copySeedMxfoodForMode` with direct SQL, deliberately never touching `/org` (the template also carries `/org/configs/config`, i.e. real workspace branding). |

## Gotchas

- **`DocumentDB` is import-restricted.** ESLint `RESTRICT_DOCUMENTS_DB` allows
  `@/lib/database/documents-db` only in `lib/data/*.server.ts` / `lib/data/*/*.server.ts`,
  `lib/database/**`, `scripts/**`, and tests/mocks. The allowlist is keyed on the `*.server.ts`
  *category*, not a file list, so a genuine new sibling needs no eslint edit. A sibling rule
  (`RESTRICT_ADAPTER_FACTORY`) bans `@/lib/database/adapter/factory` (`createAdapter`/`getAdapter`)
  outside `lib/modules/db/**` and `lib/database/**` — direct adapter construction creates an
  isolated instance that silently loses writes.
- **`export → import` used to lose `draft` and `meta`, and now must not.** `exportDatabase` mapped
  neither column and `importToDatabase`'s INSERT list omitted both, so the whole-DB migration path
  (and the admin export/import round-trip) reset every row to `draft = false, meta = NULL` —
  destroying public share links, and collapsing coexisting same-path drafts into published rows that
  violate the partial unique index. Both are carried now, and
  `lib/database/__tests__/export-import-round-trip.test.ts` pins the whole row surviving as well as
  an older export written without those keys still importing onto the column defaults. Since
  `migrate-db` is the *only* production migration path, this path has no row-wise alternative to fall
  back to.
- **`applyMigrations` clamps, it does not reject.** Anything below `MINIMUM_SUPPORTED_DATA_VERSION`
  (including `0` for unversioned DBs) is treated as if it were at the minimum.
- **Two connection write paths disagree about secrets.** `FilesAPI.createFile`/`saveFile` run
  `extractConnectionSecrets`; `ConnectionsAPI.create`/`update` write `input.config` verbatim. The
  connection wizard uses the FilesAPI path (`createDraftFile('connection', …)`), so it is safe — but
  `POST /api/connections` and the registration bootstrap connection persist raw credentials in the
  document.
- **`listAll(user, includeSchemas: true)`** passes the stored config straight to `getNodeConnector`
  without `resolveConnectionSecrets`, so a connection whose credentials are `@SECRETS/…` refs cannot
  authenticate on that path. Reachable via `GET /api/connections?includeSchemas=true`; no in-repo
  caller sets it.
- **The context strip list is shorter than the context inject list.** `contextLoader` adds
  `fullSchema, parentSchema, fullDocs, fullMetrics, fullAnnotations, fullViews, fullSemanticModels,
  parentViews, parentSemanticModels, viewProblems, fullSkills, fullAgents` to the content it
  returns (same set on the admin and non-admin branches); `saveFile` destructures away only the
  first three plus `fullSkills`/`fullAgents`. The other seven round-trip back into the stored row:
  `dbFileToFileState` keeps the enriched content verbatim, `persistableContentOf` hands it back
  whole, `file-publish.ts` POSTs it, and nothing downstream drops it — Ajv runs without
  `removeAdditional` and the context JSON schema does not name these fields. So a save persists a
  snapshot of derived state that the next load recomputes anyway. Add a computed context field and
  you must add it to BOTH lists.
- **Access-rule overrides are not cached.** `_getOverrides` in `files.server.ts` and
  `shares/shares.server.ts` calls `getConfigs(user)`, which re-reads the config document from the DB;
  that is an extra lookup on every `loadFile`/`loadFiles`/`getFiles`/`createFile`/`saveFile`.
- **PGLite serializes everything; Postgres must not.** `PgliteAdapter` funnels every
  `query`/`exec`/`transaction`/`notify`/`listen` through a promise chain — its single embedded
  connection interleaves wire messages otherwise (`08P01`, `22P02`). `PostgresAdapter` relies on the
  `pg` Pool and holds one dedicated client for all `LISTEN`s, re-establishing on `error`/`end`.
- **Array parameters bind differently per adapter.** A plain JS array is JSON-stringified by
  `PostgresAdapter` (for JSONB columns) and passed through by PGLite. For `= ANY($1)` you must wrap
  with `sqlArray(values)` — and detection uses the `isSqlArray` **brand**, never `instanceof`, because
  Turbopack can produce two distinct `SqlArray` classes in different bundles.
- **NUL bytes.** `stripNulChars` runs on every content/meta/append write; Postgres `jsonb` cannot
  represent `U+0000` and a single one aborts the write. It returns the same reference when a subtree
  is already clean, and skips non-plain objects (Date, Buffer).
- **A semicolon inside a rendered SQL fragment splits the statement.** `splitSQLStatements` (still in
  `postgres-schema.ts`) is comment-unaware and only understands dollar-quoting. There is no
  hand-written SQL left to put a comment in, so the live hazard is a `default` / `check` / `where` or
  expression-index string in `lib/database/schema/tables.ts` — nothing tests this.
- **`scope` is required on two axes because it fails open on both.** Every `Table` must declare
  `scope` (`shared` / `per-namespace` / `public`) and every `Unique` must declare `scope`
  (`scoped` / `global`). `lib/database/schema/__tests__/equivalence.test.ts` asserts both are present
  precisely because forgetting either produces the permissive answer silently: an unscoped table reads
  as shared across the whole deployment, an unscoped unique as a global invariant. A unique *index*
  is a third axis, and the opposite case: `Index.scope` is optional and defaults to the conservative
  `scoped`, so the test does not check it — but that means a genuinely deployment-wide index has to
  say `global` out loud (`idx_public_data_binding_unique` does; `idx_files_path_published_unique`
  takes the default).
- **Primary keys must stay auto-named `<table>_pkey`.** `renderTable` always emits the PK as a
  table-level constraint, never inline, and `equivalence.test.ts` checks every one. Upserts target the
  constraint by name rather than by column list, which is what lets one statement keep working against
  a schema variant that adds scoping columns; an explicit `CONSTRAINT` clause would break all of them
  at once.
- **The golden snapshot is the evidence, not the tests.**
  `lib/database/__tests__/schema-shape.test.ts` records the introspected catalog — columns,
  constraints, index definitions, normalised trigger bodies — via `test/harness/schema-introspect.ts`,
  which plays the role `pg_dump --schema-only | diff` plays against real Postgres but runs against
  PGLite in the ordinary suite. It was recorded from the original hand-written SQL and still matches,
  which is the proof that generating the DDL builds the same database. Any deliberate change makes it
  red until re-recorded.
- **A logical key is not a physical key, and DuckDB only sees the physical one.** The store prefixes
  every key with the namespace, but DuckDB is handed an `s3://` URL or a filesystem path and reads it
  itself, and `lib/csv-processor.ts` reads bytes directly for xlsx expansion. Both must call
  `resolveObjectKey()` on the stored `s3_key` first. Joining the logical key looks correct and reads
  the directory one level up: the parquet exists, the query does not find it, and DuckDB reports "No
  files found that match the pattern" — which reads like a lost upload rather than a path bug. The
  same applies to `allowed_directories`: `csv-connector.ts` takes `.split('/')[0]` of the **physical**
  key, because allow-listing the logical prefix (`csvs`) refuses every read once
  `enable_external_access` is off. `lib/connections/__tests__/csv-connector-physical-key.test.ts` pins
  both halves.
- **`getByIds` filters non-positive ids** before building the `IN (…)` list: virtual/placeholder file
  ids are negative and can exceed `int4`, which would throw `22003`.
- **`getFiles` pre-fetches folder children in one query** (`resolveChildIdsCached`) — the N+1 fix for
  Sentry MINUSX-BI-9, where 19 `path LIKE` round-trips fired in a single `/api/files` call.
- **`batchSaveFiles(dryRun: true)`** goes straight to `DocumentDB.batchSave`, whose preflight is
  PURE READS — path conflicts (against published rows and between batch entries) are detected by
  SELECT and nothing is ever written. Client-side `BEGIN`/`ROLLBACK` through the pooled Postgres
  module is not a transaction (each exec may use a different pool client), so a write-then-rollback
  preflight would actually commit; read-only is the only correct shape. It deliberately skips the
  per-file permission and gate logic that the non-dry-run loop applies. `batchSave`'s write phase is
  one `UPDATE … FROM (VALUES …)` (same pattern as `applyFolderMove`) so a real batch is
  all-or-nothing on every backend. The non-dry-run `batchSaveFiles` loop is best-effort:
  `ConflictError`s accumulate in `conflicts` and do not abort, any other error propagates.
- **Deleting a `context` is normally forbidden**, except when the folder holds more than one, or when
  its parent folder is itself part of the subtree being deleted.
- **Dead code in this slice:** `checkFileAccess` (superseded by `canAccessFile`, only tests call it);
  `DocumentDB.updateNamePath`, `renameAndMove`, `updatePath` (no callers).

## Key files

| Task | File |
|---|---|
| Add/modify a file operation | `lib/data/files.interface.ts`, then both `files.server.ts` and `files.ts` |
| Change what a file type looks like on read | `lib/data/loaders/registry.ts` + the loader (guard `content === null`) |
| Change permission semantics | `lib/data/helpers/permissions.ts` (`canAccessFile`, `canViewFileInUI`) |
| Add SQL against `files` | `lib/database/documents-db.ts` (nowhere else) |
| Add a table/column/index | `lib/database/schema/tables.ts` (declare `scope`), then re-record `lib/database/__tests__/__snapshots__/schema-shape.test.ts.snap`. **No migration entry** — `schema/render.ts` emits `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for every column on every boot |
| Change what a loader may skip | `lib/data/loaders/types.ts` (`LoaderOptions`) — a new flag must never be able to skip redaction |
| Widen what the schema can express | `lib/database/schema/types.ts` + `schema/render.ts` — never a raw-SQL string |
| Add a migration | `lib/database/migrations.ts` + bump `LATEST_DATA_VERSION` in `constants.ts` — only for changes to existing row *content* |
| Change the data-version range this build serves | `lib/database/constants.ts`, then run `scripts/check-min-data-version.ts` against the deployment |
| Understand what the gate blocks, and how migrate-db escapes it | `lib/http/__tests__/data-version-gate-escape.test.ts` |
| Change seed data | `lib/database/workspace-template.json` (static import — restart dev) |
| Change registration/bootstrap | `getModules().namespace.provision()` (`app/api/orgs/register/route.ts`) → `lib/modules/auth/index.ts` |
| Swap the DB backend | `lib/database/adapter/factory.ts`, `adapter/pglite-adapter.ts`, `adapter/postgres-adapter.ts` |
| Register a capability at boot | `lib/instrumentation/register-modules.ts`, `lib/modules/types.ts` |
| Store or serve a blob | `lib/object-store/index.ts` (`createObjectStore`), `namespaced.ts`, `s3-adapter.ts`, `local-fs-adapter.ts` |
| Read a stored object without going through the store (DuckDB, direct fs) | `resolveObjectKey()` in `lib/object-store/index.ts` |
| Change what isolates one workspace from another | `lib/modules/types.ts` (`INamespaceModule`) + `lib/modules/namespace/index.ts` |
| Add a namespace level, or change how a level is joined | `lib/namespace/types.ts` |
| Add a credential-bearing config field | `lib/secrets/config-secret-specs.ts` (`CONFIG_SECRET_SPECS`) |
| Resolve a credential server-side | `lib/secrets/connection-secrets.server.ts`, `config-secrets.server.ts` |
| Public share links | `lib/data/shares/shares.server.ts` + `files.meta.shares[]` + `idx_files_meta_shares` |
| System file tags (`files.meta.tags` → browser badges) | `lib/types/files.ts` (`getFileTags`, `FILE_TAG_LEGACY_STORY`) · stamped by V39 in `lib/database/migrations.ts` (`isLegacyStory`) · rendered by `components/file-browser/FileTagBadges.tsx`. System-written only — no user or save-path writer; re-running the migration transform is the refresh |
| Understand draft/publish semantics | `lib/database/__tests__/draft-path-uniqueness.test.ts`, `lib/data/__tests__/draft-folder-visibility.test.ts` |

---
