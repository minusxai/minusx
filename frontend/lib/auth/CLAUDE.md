# Auth, access control, mode isolation and the rubric

Who the user is, what they may touch, and how one workspace's data is kept out of another's.
Seven directories, all routed here: `lib/auth` (sessions), `lib/middleware` (the request gate),
`lib/http` (route wrappers + the client fetch layer), `lib/mode` (path-prefix isolation),
`lib/namespace` (the coarser prefix algebra), `lib/oauth` (MCP bearer tokens) and `lib/rubric`
(file-health scoring).

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## Auth, Access Control, Mode Isolation, HTTP Helpers, and the File-Health Rubric

### The three authorization stages

Every request that touches workspace data passes three independent gates. Knowing which one a
route skips is the fastest way to reason about a security question here.

1. **Middleware** (`lib/middleware/create-middleware.ts`) — session present, `tokenVersion`
   current, namespace resolves, and the identity headers are rewritten from scratch. **The
   public-route list at the top of `routeRequest` skips this wholesale**: `/login`, `/register`,
   `/l/…` shares, `/s/…` remote sessions, `/api/mcp`, `/oauth`, `/.well-known/oauth`, the Slack
   webhooks, `/api/orgs/register`, `/api/health`, `/api/jobs/cron`, `/api/admin/min-data-version`
   and a valid `mx-guest` cookie on a share path.
2. **The route wrapper.** `withAuth` (`lib/http/with-auth.ts`) resolves `getEffectiveUser()`
   (`null` ⇒ `401`) **and then runs the data-version gate** — `checkDataVersion()` per request,
   `503` when this build cannot correctly read the workspace's data. Alternatives:
   `withCronAuth` (bearer `CRON_SECRET` only), `withRemoteSessionAuth` (`/s/<code>`), and
   `withAuthSkippingDataVersionGate`, which exists for exactly one route —
   `/api/admin/migrate-db`, the call that clears the gate, and which would otherwise be blocked
   by the thing it exists to unblock. Routes that build their own `EffectiveUser` (MCP, Slack,
   the cron scan) use none of these.
3. **Per-file access** — `canAccessFile` in `lib/data/helpers/permissions.ts`, called from
   `lib/data/files.server.ts` and `lib/data/shares/shares.server.ts` below every route. Not
   skippable: it is the layer that makes the public branch of stage 1 safe.

### What each module owns

**`lib/auth/`** owns *who the caller is*. `auth-factory.ts` builds the NextAuth v5 config
(credentials provider, JWT sessions, 7-day `maxAge`) and is instantiated exactly once in
`frontend/auth.ts`. `auth-helpers.ts` owns the `EffectiveUser` type and `getEffectiveUser()`,
the single request-scoped identity resolver every server route uses. `access-rules.ts` /
`access-rules.client.ts` own *role → file-type* permission, read from `frontend/rules.json`.
`role-helpers.ts` owns the three role predicates. `guest-session.ts` + `share-tokens.ts` own
anonymous public-share identity. `embed.ts` owns iframe-embedding cookie/CSP config.
`otp-utils.ts` / `password-utils.ts` own credential primitives. `e2e-runtime.ts` owns the
runtime E2E opt-in gate.

It does **not** own per-file ACL. Whether *this* user may touch *this* file is
`lib/data/helpers/permissions.ts` (`canAccessFile`), which composes `canAccessFileType`,
`isAdmin` and the mode path helpers; `canViewFileInUI` wraps it with the extra `canViewFileType`
check used for listings and search. It also does not own the user table
(`lib/database/user-db.ts`) nor the org-level rule overrides (`AccessRulesOverride` in
`lib/branding/whitelabel.ts`, delivered via the config document).

**`lib/mode/`** owns the *path algebra* of mode isolation: `Mode = 'org' | 'tutorial' |
'internals'`, `resolvePath(mode, logicalPath)`, `extractLogicalPath`, the system-folder tables,
and home-folder resolution. It does **not** own mode *selection* — that is
`lib/middleware/create-middleware.ts` (server) and the `?mode=` URL param propagated by
`mode-utils.ts` + `lib/http/fetch-patch.ts` (client). It performs no I/O; `resolveHomeFolder`
takes an injected `checkExists`.

**`lib/middleware/create-middleware.ts`** owns the auth gate and header normalization for every
request. It is the *only* place `x-mode`, `x-view`, `x-impersonate-user`, `x-user-id`,
`x-request-id`, `x-request-path` and `x-e2e-enabled` are set. `frontend/middleware.ts` is a
three-line wrapper; the matcher and `runtime: 'nodejs'` must stay a static literal there.

**`lib/http/`** owns the API surface contract in both directions. Server: `with-auth.ts`
(`withAuth`, `withCronAuth`), `with-remote-session-auth.ts` (`/s/<code>` capability auth),
`api-responses.ts` (`successResponse` / `errorResponse` / `ApiErrors` / `handleApiError`),
`api-types.ts` (`ApiResponse`, `ErrorCodes`). Client: `fetch-wrapper.ts` (caching + dedup +
abort), `useFetch.ts`, `declarations.ts` (endpoint catalog), `fetch-patch.ts` (global
`window.fetch` monkey-patch). It does **not** own the error *classes* — `UserFacingError`,
`FileNotFoundError`, `AccessPermissionError`, `FileExistsError` live in `lib/errors.ts` and
`handleApiError` only maps them to status codes. It also does not own the client file-data path:
that is `FilesAPI` (`lib/data/files.ts`), which does its own fetching; only a subset of
`declarations.ts` is actually referenced (see Gotchas).

**`lib/namespace/types.ts`** is the whole of `lib/namespace`: the *vocabulary* of the coarser
isolation axis, with no behaviour. `NAMESPACE_HEADER` (`x-namespace-context`) is named once here
so middleware and handlers cannot disagree; `DEFAULT_ISOLATION` (`'mx'`) is the single-workspace
root, non-empty on purpose so `${isolation}/${key}` never emits a leading separator;
`buildNamespace({isolation, mode, userId})` joins the three levels **coarse to fine** —
`isolation` (durable: object store, channels; deliberately mode-independent), `mode`
(`isolation` + mode), `user` (`mode` + user id) — and `namespaced(level, key)` /
`namespacedChannel(isolation, channel)` are the only sanctioned joins, the latter because a
NOTIFY channel is a SQL identifier and cannot carry `/` or start with a digit. The *behaviour*
behind the seam is `INamespaceModule` — see "Architecture — the namespace seam".

**`lib/oauth/db.ts`** owns OAuth 2.1 credentials for the MCP endpoint. Despite the filename it
owns **no database tables**: PKCE authorization codes live in a `globalThis`-backed in-memory
`Map` (5-minute TTL), and access (1h) / refresh (30d) tokens are stateless JWTs signed with
`NEXTAUTH_SECRET`, discriminated by a `type` claim. It does not own the OAuth routes
(`app/oauth/*`, `app/.well-known/oauth*`) or the bearer→`EffectiveUser` bridge
(`lib/mcp/auth.ts`).

**`lib/oauth/base-url.ts`** derives the OAuth origin from the request (`x-forwarded-proto`, first
hop of a comma-separated chain, plus `host`) rather than from configuration, so one image serves
correct discovery documents behind a proxy, through ngrok, on localhost, and on a per-workspace
host — where a configured base URL would send clients to somebody else's discovery document. Both
`.well-known/oauth-*` routes and the `api/mcp` 401 challenge share the one helper rather than
keeping per-route copies.

**`lib/rubric/`** owns file-health scoring: the report contract (`types.ts`), the scoring math
(`scoring.ts`), four pure deterministic scorers (`deterministic/*`), the check catalogs
(`checks.ts`), the LLM judge adapter (`llm/score-llm.server.ts`), and the two entrypoints
(`registry.ts` deterministic-only, `score-file.server.ts` combined). It does **not** own the LLM
call (`runMicroTask` → `MicroAgent`, prompts in `micro.rubric_llm` of
`orchestrator/prompts/prompts.yaml`), screenshot capture (`lib/screenshot/`), or the UI
(`components/file-browser/FileHealthPanel.tsx`).

### Architecture — identity and mode

```
  ?as_user=… ?mode=… ?view=… ?e2e=…        cookies: authjs.session-token | mx-guest | mx_e2e
                 │
                 ▼
  middleware.ts → createMiddleware()          ← auth() wraps it; req.auth = NextAuth session
    · public / share / remote-session / guest branch → x-request-id, x-request-path,
                              x-namespace-context; every other inbound header passes through
    · no session            → 302 /login?callbackUrl=…
    · tokenVersion < CURRENT_TOKEN_VERSION → 302 /login   (auth-constants.ts)
    · authenticated branch  → x-user-id, x-mode (admin-gated for 'internals'),
                              x-view, x-impersonate-user (admins only), x-e2e-enabled
                 │
                 ▼
  getEffectiveUser()   (React cache() → once per request)
    · session? → impersonation lookup (UserDB.getByEmail) else session claims
    · no session + isShareGuestPath → verifyGuestToken(mx-guest) → guestToEffectiveUser
                 │
                 ▼
  EffectiveUser { userId, email, name, role, home_folder, mode, view?, guest? }
                 │
     ┌───────────┴────────────────────────────────┐
     ▼                                            ▼
  resolvePath(mode, '/…')                 canAccessFile(file, user, overrides)
  resolveHomeFolderSync(mode, home_folder)   (lib/data/helpers/permissions.ts)
                 │                                │
                 └──────────► every DocumentDB query is mode-prefixed
```

`home_folder` is stored **relative** (`'sales/team1'`) and resolved against the live mode at
access time, which is what makes one user row work in `/org` and `/tutorial` simultaneously.

**Mode isolation is a path-prefix convention, and `canAccessFile` is where it is enforced.**
There is no mode column: a file is in a mode because its `path` starts with `/org`, `/tutorial`
or `/internals`. The checks run in a fixed order, and a non-admin can be admitted by any of
three separate grants — miss one and a whole class of file silently disappears from the UI:

1. **Type** — `canAccessFileType(user.role, file.type, overrides)`. This runs *before* the mode
   check, so a role denied a file type is refused regardless of where the file lives.
2. **Mode** — `file.path === '/{mode}'` or starts with `/{mode}/`. Applies to admins too: an
   admin in tutorial mode sees nothing under `/org`.
3. **Admin short-circuit** — `isAdmin(user.role)` returns `true` here; steps 4–6 are non-admin
   only.
4. **Home folder** — at or under `resolveHomeFolderSync(mode, home_folder)`, *minus* anything
   `isUnderSystemFolder` matches (system subtrees are carved out and re-granted selectively by
   step 5).
5. **`isAccessibleSystemPath`** — re-grants exactly three subtrees: `/{mode}/database`
   (connections, read for everyone), `/{mode}/logs/conversations/{userId}` (own conversations),
   `/{mode}/logs/runs` (job run outputs).
6. **`isAncestorContext`** — a `context` file whose directory is an ancestor of the user's home
   folder, so hierarchical schema filtering can read `/org/context` from `/org/sales`.

`/{mode}/visualizations` looks like a seventh case and is not one: it holds no rows. The
read-only recipe catalog (`lib/viz/recipe-catalog.ts`) is code — the built-in and shipped chart
recipes — synthesized per request by `FilesAPI` and scoped to the CALLER's mode, so there is
nothing to grant and no cross-mode path to leak. It is deliberately absent from
`HIDDEN_SYSTEM_FOLDERS` (browsing it is the point) and every write path refuses its ids.

`checkFileAccess` in the same file is a *legacy* export with no production callers (only
`lib/__tests__/lib-unit.test.ts`). It runs mode first and has no type check — do not copy its
order.

Background callers with no HTTP request build the user directly and pass mode explicitly:
`getUserEffectiveUser(email, mode)` (Slack), `lib/mcp/auth.ts` (bearer token → `DEFAULT_MODE`),
`resolveRemoteSession` (owner of the `/s/<code>` session).

### Architecture — the namespace seam

Mode is one isolation axis; `INamespaceModule` (`lib/modules/types.ts`, default implementation
`lib/modules/namespace/index.ts`) is the seam a deployment implements to add a coarser one. Nine
members, four of them the hot path. `resolve(req, hints)` maps a request to its namespace, or
returns `null` to reject it — there is no safe default. `seal(namespace)` makes that value safe to
travel as the `x-namespace-context` request header, because middleware writes it and handlers would
otherwise trust an attacker-supplied copy; the sealed *form* is opaque to every caller.
`with(namespace, fn)` establishes one where there is no request to read it from, scoped to `fn` and
deliberately not `enterWith`-style: an ambient value cannot be unset and leaks onto whatever runs
next on the same async context, which on a pooled server is an unrelated request. `isolation()`
returns the current request's coarse prefix.

The other five are lifecycle, not request handling: `provision(input)` creates and seeds a
namespace (one workspace ⇒ the ordinary first-run `AuthModule.register`);
`bindExternalId`/`unbindExternalId` record which namespace owns a third-party id (`slack_team` is
the only `ExternalIdKind` today); `installFinishUrl(returnUrl)` redirects an OAuth install that
landed on the wrong host, `null` to finish where it arrived; and `minDataVersion()` reports the
OLDEST data version across every namespace served, which is what makes "is it safe to raise
`MINIMUM_SUPPORTED_DATA_VERSION`?" answerable *before* a deploy. The single-workspace
implementation answers a constant for the first four, no-ops both bind verbs, returns `null` from
`installFinishUrl`, and reads its own version for `minDataVersion`.

Three entry points cannot go through middleware and resolve for themselves, each because the
namespace is not in the URL: `app/api/mcp/route.ts` (it is in a bearer token), the Slack events
webhook (it is a `team_id`), and `app/oauth/authorize/approve/route.ts`. Each wraps its handler in
`with()`. Work that outlives its request — a detached chat turn, an `after()` callback — re-enters
via `getModules().auth.getContextRunner()`, which must be awaited **while the request is still
alive**, since that is when it captures the namespace. A JWT refresh has no request at all, so
`auth-factory.ts` stamps the namespace onto the token at login (`getExtraTokenPayload`, and the
`namespace` claim in `types/next-auth.d.ts`) and re-enters it around the `UserDB.getById` read. In
this repo `resolve()` ignores the session entirely, so nothing compares the session's namespace
against the request's — that comparison is what an implementing deployment adds, and the claim exists
so it can.

### Architecture — role rules

`frontend/rules.json` (`version: 3`) is the data. Three rule kinds matter: `fileTypeAccess` (per
role: `allowedTypes` for API access, `createTypes` for create **and** edit, `viewTypes` for UI
listing), `createLocationRestrictions` (mode-resolved required path prefixes), and the
`creationBlocklist` / `deletionBlocklist`.

Two implementations read it and must stay in step: `access-rules.ts` (server;
`fs.readFileSync(process.cwd()/rules.json)`, cached except in dev) and `access-rules.client.ts`
(client; static `import rulesConfig from '@/rules.json'`). Both apply the org's
`AccessRulesOverride` field-by-field on top. The client half exposes `useAccessRules()`, which
binds the overrides from `selectConfig` so components never pass them manually.

The default context contract deliberately separates background access from UI visibility:
viewers may load `context` files so their docs, schema, skills, and agents can govern the app,
but `context` is absent from both viewer `viewTypes` and `createTypes`. Editors and admins may
view and edit contexts. The standalone Agents and Skills surfaces expose only those context-backed
components: viewers can access Agents but see only enabled entries and retain their Explore actions;
Skills is editor/admin-only. Editor/admin changes save back through the context container.

### Architecture — the rubric

```
  content (+ ctx)                              screenshot (data: or https)
        │                                              │
        ▼                                              ▼
  scoreFileDeterministic()                     scoreFileLLM()
  registry.ts → deterministic/{question,       llm/score-llm.server.ts
    dashboard,story,context}.ts                  → runMicroTask('rubric_llm', …)
        │  RubricFinding[] (source:'rule')        → parse {checks:[{id,pass,reason}]}
        │                                         → FAIL ⇒ finding (source:'llm')
        └───────────────► combineReports() ◄──────────┘
                                │
                          buildReport(fileType, findings, assessed)   ← scoring.ts
                          · category = 5 − Σ severity deduction, rounded to 0.5
                          · ANY error ⇒ that category AND overall = 0
                          · overall = weighted mean over ASSESSED categories only
                                │
                         toAgentRubric()  → what the agent reads
```

Three severities of coupling to the rest of the app: `refs.ts` derives the referenced-question
ids (dashboard assets, story `<Question id={N}>`) so the client badge, the server route, and the
agent review path all build the identical `DeterministicContext`; `score-file.server.ts`
resolves those ids via `loadFile` (best-effort, never throws); `deterministic/story.ts`
normalizes the stored placeholder-div story body back into agent JSX (`buildStoryJsx`) before
any rule runs, so rules read what the agent reads.

Consumers: `app/api/files/[id]/rubric/route.ts` (GET deterministic, POST combined),
`agents/analyst/health-tools.ts` (`CheckFileHealth` server tool),
`lib/tools/handlers/file-review.ts` (the EditFile/CreateFile/ReviewFile review core, which
degrades to the client-side deterministic rubric when a screenshot can't be captured), and
`components/file-browser/FileHealthPanel.tsx`.

The constants live beside the rules (`scoring.ts`: weights `0.3/0.3/0.4` for visual types,
`0.5/0.5/0` for context; grade bands 4 / 2.5. `question.ts`: 400/800 query tokens, ≤5 series.
`dashboard.ts`: `MIN_TILE_W/H` 2, `MIN_PLOT_TILE` 3, `MAX_VISUALS` 15, text 400/800 tokens.
`story.ts`: cartesian ≥50% of column or ≥480px, pie/funnel ≥34% or ≥260px. `context.ts`:
`MAX_DOC_TOKENS` 1000).

### Interactions with other areas

| Boundary | Contract |
|---|---|
| **API routes → `withAuth`** (~73 files) | Handler receives `(request, user: EffectiveUser, context)`. `null` user ⇒ `401` before the handler runs; a failed `checkDataVersion()` ⇒ `503` before it runs. Thrown errors are rethrown; non-abort errors also publish `AppEvents.ERROR` with `source: server:<pathname>`. |
| **API routes → `api-responses`** | `successResponse(data)` ⇒ `{success:true,data,request_id?}`; `handleApiError(e)` ⇒ `{success:false,error:{code,message,type?}}` with status from the `UserFacingError` subclass. ESLint (`eslint.config.mjs`, `app/api/**`) rejects a bare `NextResponse.json(…, {status:500})`. |
| **`lib/data/*` → `lib/auth` + `lib/mode`** | `files.server.ts` calls `canCreateFileType`, `canCreateFileByRole`, `canDeleteFileType`, `validateFileLocation` for mutations, `canAccessFile` for every read, and, for the references of a *non-folder* parent, only `canAccessFileType` + the mode prefix — a dashboard's embedded questions are authorized by the parent, so path rules are not re-applied; `shares/shares.server.ts` calls `canAccessFile`; `lib/search/file-search.ts` calls `canViewFileInUI`. All take `EffectiveUser` and are the only enforcement layer below the routes. |
| **Chat / orchestration → `EffectiveUser`** | `lib/chat/*.server.ts` and every server tool thread `EffectiveUser` for file access and mode. Guest chat is additionally gated by `guestChatDenialReason(user, SHARE_GUEST_CHAT_ENABLED)`, enforced in both chat routes. |
| **`lib/modules/registry` → namespace** | `attachNamespace` runs `getModules().namespace.resolve(req)` then `.seal()` into `x-namespace-context` in *both* middleware branches, deleting any inbound copy first. Only the authenticated branch acts on a `null` result (session cookies cleared, redirect to `/login`); the public branch discards it and proceeds with no namespace attached. |
| **`lib/modules/registry` → auth** | `AuthConfigOptions` (`auth-config-options.ts`) lets a module override user lookup, JWT refresh, and extra session fields without touching `auth-factory.ts`. `getContextRunner()` and `getExtraTokenPayload()` are the two hooks that carry the namespace past the end of a request. |
| **Client → server identity** | `fetch-patch.ts` monkey-patches `window.fetch` at import (`components/app-shell/Providers.tsx`) to re-append `as_user` and non-default `mode` to any `/api/` URL. XHR-based SSE bypasses it, so `store/api-url.ts` re-implements the same append for the chat stream. |
| **MCP → `lib/oauth`** | `app/api/mcp/route.ts` → `lib/mcp/auth.ts` → `OAuthTokenDB.validateAccessToken` → `UserDB.getById`, constructing its own `EffectiveUser` at `DEFAULT_MODE`. Middleware treats `/api/mcp`, `/oauth`, `/.well-known/oauth` as public. |
| **Remote agent sessions → `withRemoteSessionAuth`** | `/s/<code>/*`; the unguessable code is the only credential. Resolution is `resolveRemoteSession` (`lib/chat/remote-session.server.ts`); the wrapper adds a per-conversation 60-calls/60s in-memory limiter and yields `{conversation, user: <owner>, code, params}`. |
| **Rubric → orchestrator** | `runMicroTask('rubric_llm', vars, user, images)`; the checklist is rendered by `formatChecklist(fileType)` into the `{checklist}` prompt var and `fileToMarkup` supplies `{markup}`. The judge runs on a stronger model than the micro default via the code-owned grade override `rubric_llm: task('rubric_llm', 'core')` in `agents/micro/micro-tasks.ts`. |
| **Rubric → viz/story** | `refs.ts` imports `extractSavedQuestionIds` (`lib/data/story/story-question.ts`); `story.ts` imports `parseJsx` (`lib/jsx`) and `buildStoryJsx` (`lib/data/story/story-v2.ts`). Adding a viz type does not require a rubric change, but the cartesian/round sets in `story.ts` and `dashboard.ts` are hard-coded lists. |

### Gotchas

- **Header normalization only happens on the authenticated branch.** The public / share /
  remote-session / guest branches of `routeRequest` copy `req.headers` verbatim and set only
  `x-request-id`, `x-request-path` and `x-namespace-context` — a client-supplied `x-mode` or
  `x-impersonate-user` survives. `x-namespace-context` is the exception: `attachNamespace` deletes any
  inbound copy before setting its own on every branch, so a client-supplied one never reaches a
  handler. Safety rests entirely on each of those consumers building its own identity without
  trusting those headers: MCP uses `DEFAULT_MODE`, Slack passes mode explicitly, and the guest
  branch of `getEffectiveUser` derives everything from the signed cookie. Any new public route
  that calls `getEffectiveUser` breaks that invariant.
- **`getUserKey` is MODE-scoped, not user-scoped — the name lies.** `AuthModule.getUserKey`
  (`lib/modules/auth/index.ts`) returns `buildNamespace({isolation, mode, userId: 0}).mode`, i.e.
  `mx/org`; the only thing it is handed is `{ mode }`, so it *cannot* identify a user. Its one
  caller is the query-result cache in `app/api/query/route.ts`, and two users in the same mode
  therefore share cache keys deliberately — the same SQL against the same connection is the same
  result. What stops a user replaying a query they may no longer run is that
  `getWhitelistForPath` + `validateQueryTables` run **before** the cache is consulted; the key
  carries no `filePath`, so validating after a hit would be too late. Never treat this key as an
  authorization boundary.
- **The `internals` admin gate lives on the header, not on the URL.** `x-mode` downgrades a
  non-admin's `?mode=internals` to `org`, but `effectiveMode` — used only for the bare
  `/p` → `/p/{mode}` redirect — does not. A non-admin can land on `/p/internals` while their
  data plane is forced to `org`.
- **Impersonation returns before the token-version check.** In `getEffectiveUser`, a matched
  `x-impersonate-user` returns immediately; `isTokenOutdated` is only reached on the
  non-impersonating path. Stale-token rejection for impersonating admins relies on the
  middleware having already redirected.
- **`resolvePath` is idempotent by design.** `resolvePath('org', '/org')` returns `/org`, not
  `/org/org` — the exact-match case exists because `home_folder` is documented as `/org` in
  places and double-prefixing rooted file search at a non-existent path.
- **`withCronAuth` answers auth failure with `200 {ok:true}`,** not 401 — deliberate, so a
  scheduler doesn't retry-storm an unconfigured `CRON_SECRET`.
- **`handleApiError` reports nothing.** The ESLint rule that forces it for 500s is justified in
  `eslint.config.mjs` as "ensures the error is reported to internal monitoring", but the
  function only `console.error`s. The only publisher of `AppEvents.ERROR` on the request path is
  `withAuth`'s rethrow branch — a route that catches its own error and returns
  `handleApiError(e)` never reaches it. (Detached chat turns are the exception that proves the
  rule: they run off the request path, which is why `runConversationTurn` publishes its own
  `ERROR` + `chat:turn` events — see `frontend/lib/chat/CLAUDE.md`.)
- **`handleApiError` has a legacy substring fallback:** any non-`UserFacingError` whose message
  contains `'not found'` becomes a 404 whose body says `"Resource not found"`, discarding the
  original message. Throw a `FileNotFoundError` to control the response.
- **`isClientAbortError` matches `'aborted'` exactly** (plus `AbortError` / `ECONNRESET`), not by
  substring, so genuine errors that merely mention aborting still get reported.
- **`fetchWithCache` aborts the previous in-flight request with the same cache key.** With
  `deduplicate: true` the second caller joins the first instead, so this only bites
  non-deduplicated endpoints. In-flight cleanup deliberately attaches two handlers to the
  original promise rather than `.finally(...)` — the latter branches a floating chain and
  surfaces failures as unhandled rejections (`__tests__/fetch-wrapper-dedup.ui.test.ts`).
- **`lib/http/declarations.ts` is largely unreferenced.** Only 18 of its endpoints are used
  (`files.search`, `files.delete`, `folders.create`, `conversations.listRecent`, the `admin.*`,
  `auth.*`, `recordings.*` and `orgs.register` groups). The rest — including
  `API.chat.send`, which points at `/api/chat`, a directory with no `route.ts` — are dead;
  file CRUD goes through `FilesAPI` instead.
- **Server and client access rules load `rules.json` differently.** The server reads it from
  `process.cwd()` at runtime (re-read on every call in dev, cached in prod, falling back to a
  hard-coded 3-role default if the file is missing); the client bundles it at build time. A
  deployment that ships the app without `rules.json` next to `cwd` silently degrades to that
  fallback, which knows only `question`/`dashboard`/`folder`.
- **`createTypes` governs editing as well as creating** (`canCreateFileByRole`), and an *absent*
  `createTypes` means "everything allowed", not "nothing".
- **Guest sessions are scope-pinned by the cookie alone.** `isShareGuestPath` admits only `/l/…`
  and `/api/…`; the main app UI ignores the cookie entirely. The synthetic guest `userId` is
  negative and derived from `sha256(nonce:email)` so guest conversation folders never collide
  with real users or the cron `-1` user. A share link's authorization is nothing but the nonce
  presence + non-revoked flag on `file.meta.shares[]` — `decodeShareLink` proves nothing.
- **Enabling embedding flips cookies to `SameSite=None; Secure` for everyone on that deploy.**
  `parseFrameAncestors` returns `''` for both the disabled case *and* `'*'`, so no CSP header is
  emitted in either — `'*'` is strictly more permissive than an explicit origin list.
- **`CURRENT_TOKEN_VERSION` (currently 2) is checked in two places** — middleware (redirect) and
  `getEffectiveUser` (returns `null` ⇒ 401). Bumping it logs everyone out.
- **Rubric: an `error` is a gate, not a deduction.** One error anywhere zeroes the overall to 0 /
  `poor` regardless of the other categories, and each category's own score also drops to 0. A
  category the source did not evaluate is `score: null, assessed: false` and is excluded from
  the weighted mean rather than counted as 5.
- **Every check in `LLM_CHECKS` is categorized `aesthetics`, but cataloged does not mean active.**
  Question's seven, dashboard's seven, and story's thirteen checks have `status: 'paused'`; context
  has no entries. `activeLlmChecks` is the runtime boundary, so `scoreFileLLM` currently makes no
  model call for any file type. Question visual structure is checked deterministically from its
  authoritative V2 `viz` envelope (with legacy `vizSettings` used only when V2 is absent).
- **Judge voting is dormant and configured to one vote.** Every LLM check is paused. If one is
  reactivated, `JUDGE_VOTES = 1` in `score-llm.server.ts`; a check the run omits from its JSON is
  treated as neither pass nor fail.
- **`CheckFileHealth` scores the last SAVED content**, while the rubric route's POST scores the
  caller-supplied merged content so the score matches the screenshot. A fresh unsaved draft
  therefore scores 0/5 through the tool.
- **The live thresholds, stated plainly** because they are easy to misremember: `visual-count`
  warns above `MAX_VISUALS = 15`, while `no-visuals` errors at zero; `JUDGE_VOTES = 1`;
  `too-much-text` warns above 400 tokens, while `extreme-text` errors above 800; `typed-number`
  fires only on clearly formatted metric shapes in prose (`findFactualNumbers`,
  `deterministic/shared.ts`) — a `$`-prefixed figure, a `%`-suffixed one, or a comma-grouped
  thousands value. Bare digit runs are ignored as possible ids/years/references; `$12` and `7%`
  still trip it. The dormant judge's
  model comes from the code-owned grade override `rubric_llm: task('rubric_llm', 'core')` in
  `agents/micro/micro-tasks.ts`.

### Key files

| Task | File |
|---|---|
| Change who is authenticated / add a login path | `lib/auth/auth-factory.ts` (+ `frontend/auth.ts`) |
| Change what identity a request resolves to | `lib/auth/auth-helpers.ts` |
| Add/alter a request header, public route, or redirect | `lib/middleware/create-middleware.ts` |
| Change role → file-type permissions | `frontend/rules.json` + both `lib/auth/access-rules*.ts` |
| Add a mode, or change mode path layout / system folders | `lib/mode/mode-types.ts`, `lib/mode/path-resolver.ts` |
| Add an authenticated API route | `lib/http/with-auth.ts` + `lib/http/api-responses.ts` |
| Change the namespace prefix shape, or add a level | `lib/namespace/types.ts` (`buildNamespace`) |
| Change the namespace seam's contract | `lib/modules/types.ts` (`INamespaceModule`) + `lib/modules/namespace/index.ts` |
| Change an API error's status or shape | `lib/http/api-responses.ts` (+ `lib/errors.ts` for the class) |
| Client caching / dedup / abort behaviour | `lib/http/fetch-wrapper.ts` |
| Preserve `as_user` / `mode` on a new client transport | `lib/http/fetch-patch.ts`, `store/api-url.ts` |
| Public share links and anonymous guests | `lib/auth/share-tokens.ts`, `lib/auth/guest-session.ts` |
| Iframe embedding (cookies + CSP) | `lib/auth/embed.ts` |
| MCP bearer tokens / PKCE codes | `lib/oauth/db.ts`, `lib/mcp/auth.ts` |
| Add or retune a deterministic health rule | `lib/rubric/deterministic/*.ts` + `lib/rubric/checks.ts` |
| Add or retune an LLM judge check | `lib/rubric/checks.ts` (`LLM_CHECKS`) + `micro.rubric_llm` prompt |
| Change severity scoring behavior, category weights, or grade bands | `lib/rubric/scoring.ts` |
| Score a new file type | `lib/rubric/registry.ts` (`SCORERS` + `DETERMINISTIC_COVERAGE`) |

**Why the rubric is analytic rather than one number, and how a new rule finds its home.** Quality is decomposed into atomic, independently-scored criteria because a single holistic score suffers halo effects, is not individually actionable, and calibrates poorly against human judgment — and because a judging LLM forced into structured per-criterion output is markedly less verbose and less position-biased. The three categories are a priority waterfall, so every rule has exactly one home: `correctness` ("if ignored, is it wrong, broken, or dishonest?"), then `clarity` ("it is correct, but is it hard to understand at a glance?"), then `aesthetics` ("it works and reads fine, but does it look unpolished?"). A rule belongs to the *first* category whose question it fails. The scale is deliberately coarse (0–5, rounded to 0.5) to avoid false precision, and **each category's baseline is 5 no matter how many rules it contains** — a category is penalized only for actual findings. That property is what makes the rubric extensible: adding a more granular check can never harshen the score of a clean file.

**The viz thresholds are grounded, not invented.** The dashboard visual-count band (roughly 5–9 visuals before a board stops being readable), F-pattern reading hierarchy, chart-fits-the-task, and the ≤7-categories-on-color ceiling come from published BI guidance (AHRQ dashboard design, Tableau and Sigma layout guidance); the chart-type-fit rules come from data-ink-ratio and graphical-perception work. The scoring model itself follows the analytic-rubric and LLM-judge-calibration literature. The story rules trace to our own `skill_stories` prompt — *a story is an argument with live numbers, not decoration*. Retune a constant when evidence says so, but do not treat these numbers as arbitrary defaults picked to make files pass.

**The LLM review path is currently dormant.** Every cataloged LLM check is paused, so `scoreFileLLM` returns an unassessed report without a model call for question, dashboard, story, or context. If a checklist is reactivated later, screenshot-less reviews remain weaker: the prompt marks visual-only checks `applicable: false`, and an inapplicable check can never become a finding.

**The rubric is never ambient.** It is deliberately not injected into app state or `ReadFiles` results — that was the first version's design and it read as background noise the agent learned to skip. Feedback is delivered only where the agent is already acting: `EditFile` returns the full post-edit review (and degrades to the deterministic half when nothing is mounted to screenshot), `CreateFile` returns the deterministic report because a fresh draft renders nowhere, and `ReviewFile` is the explicit no-edit review. Adding the report to a passive read path re-creates the failure it was moved away from.

**`embed-too-narrow` judges the desktop base layout on purpose.** `deterministic/story-layout.ts` resolves an embed's column-width share structurally — dividing by the track count of any multi-column `grid-template-columns` ancestor (resolving both inline `style` objects and class rules out of the story's `<style>` block), multiplying through percentage widths, and taking the tightest fixed `px` cap. `stripAtBlocks` removes `@container` / `@media` / `@supports` / `@keyframes` blocks *before* that resolution, so a narrow-viewport override that collapses the grid to one column cannot mask a base layout that squeezes a chart into a third of a column. The rule reports the structural cause of a cramped chart; whether the rendered result actually looks cramped is the judge's call.

**Two password bypasses sit ahead of the hash check in the credentials `authorize` chain.** `lib/auth/auth-factory.ts` accepts `password === user.email` when `IS_DEV`, and accepts the configured `ADMIN_PWD` for any admin in any environment, before it ever reaches `verifyPassword(password, user.password_hash)`. The dev shortcut is what lets `test/e2e/auth.setup.ts` register the workspace admin idempotently via `POST /api/orgs/register` and then log in with no seeded credential — and it is why a dev build must not be run on a reachable host.

**The runtime E2E opt-in is a hygiene gate, not a security boundary.** `?e2e=<E2E_RUNTIME_SECRET>` (validated in `lib/auth/e2e-runtime.ts`, persisted as the `mx_e2e` cookie, surfaced to SSR as the `x-e2e-enabled` header) does exactly one thing: it lets `ReduxProvider` expose `window.__MX_STORE__`, which is the requester's own Redux state, already present in their browser. No other user's data is behind it, so a leaked secret is a rotation rather than an incident. The faux-LLM channel is the part that stays build-time-only and 404s on a production build.

---
