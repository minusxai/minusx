# API and page routes

Every API endpoint and page under `frontend/app`. What this layer owns is thin: auth staging,
the `handleApiError` contract, and route grouping. The work happens in `lib/`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## What this layer owns — and what it does not

`frontend/app` is the Next.js App Router tree: 121 `route.ts` handlers plus 15 page routes and three
error boundaries (`error.tsx`, `global-error.tsx`, `not-found.tsx`). Its job is **HTTP adaptation only**:
parse and shape-check the request, resolve the caller, delegate to a `lib/` module, and map the outcome
onto a status code. Total across every route file is ~6900 lines; the largest is
`api/conversations/[id]/stream/route.ts` at 211 lines and 85 of the 121 are under 60.

It owns: request parsing/validation, auth and role gating at the edge, HTTP status/response shaping,
streaming envelopes (SSE, NDJSON), CORS headers on the public protocol endpoints, and `revalidateTag`
cache busting after mutations.

It does **not** own: business logic, database access, LLM orchestration, or permission *rules*. No
non-test file under `app/` imports `DocumentDB` — data access goes through `FilesAPI` /
`ConnectionsAPI` / `ConfigsAPI` (`lib/data/*.server.ts`). Access checks are enforced *inside* those
modules (`loadFile` is access-checked; `addShare`/`getShares` enforce admin + story type); routes that
add a role check on top are adding a second layer, not the only one.

## Auth: three stages, and the two that routes can skip

```
request
  └─ middleware.ts → lib/middleware/create-middleware.ts
       · public allowlist (login/register, /l/, /s/, /oauth, /.well-known/oauth,
         /opengraph-image, /api/auth, /api/share/guest-session, /api/orgs/register,
         /api/mcp, /api/health, /api/jobs/cron, /api/admin/min-data-version,
         /api/public/slack-chart, slack events|interact|oauth-callback) → pass through
       · plus a valid mx-guest cookie, but ONLY on share paths (isShareGuestPath)
       · otherwise require NextAuth session + CURRENT_TOKEN_VERSION, else redirect /login
       · stamps x-request-id, x-request-path, x-user-id, x-mode, x-view,
         x-impersonate-user (admins only), E2E header
  └─ route handler
       · withAuth(handler)  → getEffectiveUser() reads those headers → EffectiveUser
       · or a bespoke gate (see below)
```

`lib/http/with-auth.ts` exports **three** wrappers. `withAuth` 401s when `getEffectiveUser()` returns
null, then — before calling the handler — applies the **data-version gate**: `checkDataVersion()` per
request, answering `503` with `{error, code}` when this build cannot correctly read the workspace's
data. (Per request, not at boot, because a workspace can be migrated or a build rolled back while the
process runs.) It then wraps the handler in a try/catch that publishes `AppEvents.ERROR` (skipping
client aborts, matched by `isClientAbortError`) and **rethrows**.
`withAuthSkippingDataVersionGate` is `withAuth` minus that gate — a separate named export rather than
an option, so the exemption is visible at the route's definition. `withCronAuth` accepts only
`Authorization: Bearer $CRON_SECRET` and — deliberately — answers a bad/absent secret with
`200 {ok:true}` rather than 401, so a misconfigured scheduler doesn't alarm.

Routes that do not use `withAuth` fall into four groups, all verified:

| Gate | Routes |
|---|---|
| `getEffectiveUser()` inline | `api/files/search`, `api/conversations`, `api/recordings/**`, `api/micro-task`, `api/llm-logs`, `api/capture-error`, `api/benchmark/import`, `api/jobs/test`, `api/chat/debug-context`, `api/viz/backfill`, `api/gateway/status`, `api/object-store/{upload-url,local-upload}`, `api/conversations/[id]/{stream,llm-calls}`, `api/llm-calls/[callId]` |
| NextAuth `auth()` session | `api/users`, `api/users/[id]`, `oauth/authorize/approve` |
| bespoke credential | `s/[code]/*` (bearer code via `lib/http/with-remote-session-auth.ts`), `api/mcp` (OAuth bearer via `lib/mcp/auth.ts`), `api/integrations/slack/{events,interact}` (HMAC signature), `api/integrations/slack/oauth-callback` (signed state), `api/test/faux/*` (`E2E_MODE` flag) |
| middleware session only, no in-route identity | `api/sql-to-ir`, `api/ir-to-sql`, `api/object-store/serve/[...key]` |
| public by design | `api/health`, `api/auth/*`, `api/orgs/register`, `api/share/guest-session`, `l/[shareId]/og`, `s/[code]`, `oauth/{token,register}`, `.well-known/oauth-*` |

**Every route in that table also escapes the data-version gate**, since the gate lives inside
`withAuth`. That is correct for the public and bespoke-credential rows, and incidental for the
`getEffectiveUser()`-inline row — those routes will happily read data this build may misread. Prefer
`withAuth` for anything new.

## The `handleApiError` contract, and every deviation

`lib/http/api-responses.ts` defines the shape all JSON APIs are supposed to speak:
`{ success, data | error: { code, message, details?, type? }, request_id? }`. `handleApiError` maps
`UserFacingError` subclasses onto status codes (`FileNotFoundError`→404, `AccessPermissionError`→403,
`FileExistsError`→409, any other `UserFacingError`→400), falls back to substring sniffing on the
message (`'not found'`, `'already exists'`, `'validation'`), and otherwise returns a 500.

**`handleApiError` only `console.error`s — it does not publish `AppEvents.ERROR`.** That fan-out (the
one that reaches internal Slack) lives in `withAuth`'s catch, which fires on a **rethrow**. So the
two are mutually exclusive in practice: a route that catches and calls `handleApiError` returns the
standard envelope and is *not* reported; a route that lets the error escape is reported but answers
with a framework 500. The lint rule below pushes toward the first, so "all 500s reach monitoring" is
not what the code does.

The ESLint rule lives in `eslint.config.mjs` and is scoped to `files: ["app/api/**/*.ts"]`. It bans
exactly one AST shape: `NextResponse.json(...)` containing a `status: 500` property. Consequences worth
knowing:

- **Non-`api/` routes in this tree fall outside the glob entirely** — `oauth/token`, `oauth/register`,
  `oauth/authorize/approve`, the five `s/[code]/*` handlers, `l/[shareId]/og`, and both `.well-known/`
  routes. The `s/[code]/*` handlers still get the standard treatment because
  `withRemoteSessionAuth` calls `handleApiError` in its own catch; the others do not.
- The rule only catches the literal `500`. A route returning a raw 4xx `NextResponse.json` passes lint
  while still breaking the response shape, and **30 of the 121 routes do exactly that** — including
  `api/files/[id]`, `api/query`, `api/files/search`, `api/conversations`, `api/recordings/**`,
  `api/micro-task`, `api/jobs/test`, `api/viz/backfill`, `api/object-store/**`, `api/csv/register`,
  `api/google-sheets/{import,reimport}`, `api/chat/{feedback,log-error,debug-context}` and both
  suggestion routes. Treat the envelope as the convention for *new* code, not as an invariant you can
  rely on when consuming these: a client parsing an error body must tolerate both
  `{ success:false, error:{ code, message } }` and a bare `{ error: "…" }`.
- Deliberate deviators: **`api/query`** catches everything and returns `ApiErrors.badRequest` — a failed
  query is the query's fault, not the server's, and a 4xx keeps the client from paging the team via
  `capture-error`; `handleApiError` is only reached for non-`Error` throws. **`api/jobs/test`** shapes
  its errors as `Partial<TestRunResult>` so the eval UI can render them uniformly. **`api/mcp`** and
  `oauth/token` speak JSON-RPC and OAuth error shapes respectively.
- Nine `withAuth` routes wrap **no outer try/catch**, so an unexpected throw is rethrown by the wrapper
  and becomes a Next.js framework 500 rather than the standard envelope: `api/validate-sql` (inner
  try only), `api/autocomplete`, `api/chat/mentions`, `api/skills/system`, `api/tools/schema`,
  `api/test-error` (which exists to throw), and
  `api/integrations/slack/{oauth-start,manifest,oauth-configured}`. `l/[shareId]/og` has neither a
  try/catch nor a wrapper. These are the routes whose failures *do* reach `AppEvents.ERROR`.

## Route groups

**Conversations / chat.** The browser's chat entry points (Slack goes in-process; `s/[code]/tool` and
`api/mcp` are separate agent surfaces onto the same log). `POST api/conversations/[id]/turns` claims the run
lease and NOTIFYs *synchronously*, then fires `runConversationTurn` **detached** (`void
runInContext(...)`) and returns immediately; `GET api/conversations/[id]/stream` is the resumable SSE
tail. Supporting routes: `interrupt` (Stop), `fork` (edit-and-fork at `atSeq`), `title` (cheap
post-first-turn poll), `screenshots/[callId]` (lazy image extraction from the stored full log),
`llm-calls` (admin-only debug; the single-call sibling `api/llm-calls/[callId]` is too), `remote-session` (mint/stop/status). `api/conversations` itself is
keyset-paginated metadata only. Aux: `api/chat/{feedback,log-error,mentions,debug-context}`.

```
POST /api/conversations/:id/turns
  ├─ owner+mode check · runStatus guards (remote → 409, running → {alreadyRunning})
  ├─ boundContextAppState(agentArgs.app_state)   ← server-side OOM backstop
  ├─ acquireRunLease + notifyStatus('running')   ← BEFORE returning
  └─ void runConversationTurn(…)                 ← detached; 200 {started:true}
GET  /api/conversations/:id/stream?since=&view=
  └─ flushCatchup → subscribe(LISTEN/NOTIFY) → {message|delta|status|pending|done}
```

**Query.** `api/query/route.ts` is the one place SQL is executed for the browser, and its **statement
order is load-bearing** (proven by `api/views/__tests__/query-route-views.test.ts`): guest guard →
whitelist validation → dialect resolution → view inlining → cache/lease/execute. Dialect comes from
`ConnectionsAPI.getRawByName`, never `FilesAPI.loadFile` — a regression guarded by
`api/query/__tests__/query-route-no-profiling.test.ts`. The response is plain NDJSON
(`application/x-ndjson`) with metadata in `X-Cache` / `X-Cached-At` / `X-Row-Count` headers.
`api/query-estimate` reads p50/p90 from `query_execution_events` for the progress UI.

**Files & folders.** `api/files` (list/create), `api/files/[id]` (GET/PATCH/DELETE),
`api/files/{batch,batch-save,batch-move,by-path,search,template}`, `api/folders`, plus per-file
subresources `api/files/[id]/{share,preview,rubric}`. PATCH is overloaded: `content === undefined` means
a metadata-only `moveFile`, anything else is a full `saveFile`. Saving a `config` busts the `configs`
cache tag; saving a `context` re-runs the loader with `{refresh:true}` because `saveFile` strips
`fullSchema`.

**Connections, contexts, semantic models, views.** `api/connections` (+ `[name]`, `test`) wrap
`lib/data/connections.server.ts`; `force_refresh=true` busts the `database-schema` tag.
**There is no `/api/contexts` route** — contexts are a file type and are read through `api/files`. A
`contexts.list` entry pointing at `/api/contexts` still exists in `lib/http/declarations.ts` (as does
`completions` → `/api/completions`); both would 404. `api/semantic-models` is a single POST that
multiplexes four modes off the body (`testModel` → save-gate test, `sql` → detect, `q` → field search,
`tables` → scoped models). `api/views/{prepare,promote}` are the view save gate and question→view
promotion.

**Jobs.** `api/jobs/cron` (`withCronAuth`, per-minute external scheduler → `runForOrg` + `runCreditResets`),
`api/jobs/run` (manual/forced → `runJob`, whose typed outcome union maps 1:1 to status codes),
`api/jobs/runs` (history), `api/jobs/test` (single eval Test via `createServerRunner`).

**Auth, orgs, users.** `api/auth/[...nextauth]` re-exports the NextAuth handlers; `check-2fa`,
`send-otp` (phone 2FA *or* passwordless email), `verify-otp` (stateless JWT round-trip) sit beside it.
`api/orgs/register` is the workspace bootstrap (gated by `ENABLE_ORG_CREATION`).
`api/users` + `api/users/[id]` use `auth()` directly rather than
`withAuth` and do their own admin-vs-self authorization.

**Admin / settings-backing.** `api/admin/{db-version,validate-db,migrate-db,export-db,import-data,
reset-tutorial,migrate-conversations-v3}` — all `isAdmin`-gated behind `withAuth`. `reset-tutorial`
wipes `/tutorial` and `/internals` back to `workspace-template.json` and deliberately never touches
`/org`. Also admin: `api/cache/clear`, `api/llm/{registry,test}`, `api/llm-logs` (DELETE),
`api/credits/{events,reset}`, `api/tools/{schema,execute}`, `api/viz/backfill`, `api/test-error`
(additionally `IS_DEV`-gated, 404 in prod), and the Slack management routes
`api/integrations/slack/{oauth-start,oauth-configured,manifest,manual-install,test-message,bots/[teamId]}`.

Two admin routes break the `isAdmin`-behind-`withAuth` pattern, both because of the data-version gate.
`api/admin/migrate-db` uses `withAuthSkippingDataVersionGate` — it is the route that clears a failing
gate, so gating it would make the refusal unescapable. `api/admin/min-data-version` uses `withCronAuth`
(shared secret, no session) and sits in the middleware's session-exempt list; it reports the oldest
data version this deployment serves, for deploy tooling that has no session. It is distinct from
`api/admin/db-version`, which is session-gated and reports the version of the workspace making the
request. It returns only the minimum — anything richer is a database query away for whoever
legitimately needs it, and this endpoint is reachable with a shared secret.

`api/gateway/status` backs the plan-and-balance panel, and its **guard order is deliberate**: it
returns `{enabled: false}` for a workspace with no stored `gateway.orgSecret` *before* the admin check,
because such a workspace is not in a broken state and has no spend to protect; the `role !== 'admin'`
403 sits after it, since spend is org-wide. The org secret is resolved server-side and only the
resulting numbers come back (`app/api/gateway/__tests__/status.test.ts` asserts neither the raw secret
nor its `@SECRETS/…` ref appears in the response). A gateway outage returns
`{enabled: true, reachable: false}` rather than an error, so the panel can say "temporarily
unavailable" instead of rendering a stale zero.

**Remote agent sessions.** Public bearer surface under `s/[code]/`: the skill-doc markdown page
(`s/[code]/route.ts` — assembled per request from live connections + `RemoteSessionAgent.tools`),
`context`, `tool`, `result/[toolCallId]`, `end`. All but the doc page use `withRemoteSessionAuth`, which
resolves the code, applies a 60-calls/60s per-conversation in-memory rate limit, and hands the handler
the conversation plus the **owner's** `EffectiveUser`.

**Public share.** `api/share/guest-session` mints/refreshes the `mx-guest` cookie from a share nonce;
`api/files/[id]/share` manages the links (admin-only); `api/files/[id]/preview` composes and stores the
social card; `l/[shareId]/og` serves it. Guest scoping downstream is enforced by `getEffectiveUser` plus
the `user.guest` branch in `api/query`.

**MCP + OAuth.** `api/mcp` is one Streamable-HTTP endpoint (POST tool calls, GET SSE, DELETE terminate)
with an in-memory session map pinned to `globalThis` so it survives HMR, pruned every 30 minutes.
Discovery and issuance live in `.well-known/oauth-authorization-server`,
`.well-known/oauth-protected-resource`, `oauth/register` (RFC 7591 dynamic registration that always
returns the single public client `minusx-mcp`), `oauth/authorize` (+ `approve`), and `oauth/token`
(PKCE authorization_code, plus single-use rotating refresh tokens — covered by
`oauth/token/__tests__/refresh-flow.e2e.test.ts`).

**The `api/mcp` 401 is the entry point to all of that, not just a rejection.** Its
`WWW-Authenticate` cites `resource_metadata` (RFC 9728) so a client holding nothing but the
endpoint URL can walk 401 → protected-resource metadata → `authorization_servers` → RFC 8414 →
register → authorize. `error="invalid_token"` is included only when a bearer token was actually
presented (RFC 6750 §3.1) — an unauthenticated first contact has nothing invalid yet. The URL is
built from the request via `lib/oauth/base-url.ts`, the same helper both `.well-known/oauth-*`
routes use, so a workspace reached on its own host is pointed at its own discovery document; and
`WWW-Authenticate` is in `Access-Control-Expose-Headers`, without which a browser client gets the
401 but cannot read the challenge off it. Pinned by
`api/mcp/__tests__/unauthorized-challenge.test.ts`.

**Object store.** `api/object-store/upload-url` issues presigned PUTs restricted to an allowlist of MIME
types (so an authenticated user can't host `text/html` under the app's S3 domain). When no S3 is
configured the client transparently uses `local-upload` (PUT, path-traversal guarded) and
`serve/[...key]` instead.

**Test hooks.** `api/test/faux/{route,reset,received}` register/clear/read the faux LLM channel and 404
unless `E2E_MODE`. `api/test-error` deliberately throws to exercise the reporting path.

**Utility cluster.** `api/{sql-to-ir,ir-to-sql,validate-sql,infer-columns}` run WASM SQL tooling;
`api/{autocomplete,column-suggestions,table-suggestions,chat/mentions}` are thin wrappers over
`CompletionsAPI`; `api/micro-task` runs a single-turn, no-tools LLM helper with no persisted
conversation; `api/story-css` compiles Tailwind for *staged* (unsaved) story drafts using the same
compiler as the save path; `api/viz/validate` is the browser's only route to the server-side Vega-Lite
validator (the 1.4 MB vendored schema must never ship to the client).

## Page routes

Only four pages are server components — `l/[shareId]`, `login`, `register`, `oauth/authorize`; the
other eleven are `'use client'`. `layout.tsx` is the only SSR data boundary: `loadInitialState()` resolves the effective
user and the org config and hands them, plus runtime flags (`maxConcurrentQueries`, `queryTimeoutMs`,
`analyticsConfig`, `disableAppStateImages`, `creditsEnabled`, `e2eEnabled`), to `Providers` as Redux
`preloadedState`. **Contexts and connections are not SSR-preloaded** — they arrive via hooks after
mount. `layout.tsx` also stamps the telemetry level on `<html>` for the prebuilt client bundle, injects
org styles, and redirects to `/hello-world` when `setupWizard.status !== 'complete'`.

The rest: `page.tsx` (home feed), `p/[[...path]]` (folder browser; middleware redirects bare `/p` to
`/p/{mode}`), `f/[id]` (file detail; the id segment may be slugged, `parseFileId`), `explore/[[...id]]`
(full-page chat — uses `useParams()` rather than `use(params)` to avoid remounting `ExploreInterface`),
`new/[type]` (creates a draft then `router.replace`s to `/f/{id}`), `new/connection` (the connection
wizard, a dedicated page rather than a `new/[type]` draft), `l/[shareId]` (public story landing;
server-renders metadata, body is client-only), `settings`, `conversations`, `recordings`, `benchmark`,
`hello-world` (onboarding wizard, `ssr:false`), `login`, `register`, `oauth/authorize`.

**Every route in this tree renders dynamically — there is no static route to protect.** A production
build reports each one as `ƒ (Dynamic)`, which follows from the middleware session gate: nothing can
be prerendered without a user. So the usual reason to avoid `useSearchParams()` in a widely-used
client component — it forces a static-rendering bailout — costs nothing here, which is why
`components/ui/Link.tsx` uses it rather than reading `window.location` during render (a hydration
mismatch on every link; see `frontend/components/CLAUDE.md`). Re-check with `npm run build` before
assuming any route is static.

## Interactions with other areas

- **← `lib/file-state/`**: the client `FilesAPI` and `lib/file-state/query-results.ts` are the callers of
  `api/files*` and `api/query`. Client query calls are bounded by `querySemaphore`, whose limit is read
  live from `configsSlice.maxConcurrentQueries` — which this tree seeds via `layout.tsx`. So the
  concurrency cap on `/api/query` is configured by a page route, not by the API route.
- **← `lib/hooks/useConversation.ts` / `lib/data/conversations.ts`**: drive the turns/stream pair. The
  browser is also the executor for frontend-bridged tools — it posts `completedToolCalls` back to
  `turns` to resume a paused orchestrator run.
- **→ `lib/chat/orchestration-core.server.ts`**: `turns` (via `lib/chat/conversation-turn.server.ts`),
  `api/tools/{schema,execute}` and `api/chat/debug-context` all read the same `REGISTRABLES` registry the
  live chat uses. Slack bypasses these routes entirely — `lib/integrations/slack/process-event.ts` calls
  the orchestration core in-process.
- **→ `lib/data/*.server.ts`**: the sole data boundary. `lib/data/files.server.ts` enforces ACLs, so a
  route omitting a role check is not necessarily a hole.
- **→ `lib/app-event-registry`**: routes publish (`QUERY_EXECUTED`, `FILE_VIEWED`, `FEEDBACK`, `ERROR`,
  `SHARE_OPEN`, `SHARE_LEAD`, `CREDIT_RESET`, `USER_MESSAGE`, `USER_CREATED/UPDATED/DELETED`, and
  `ADMIN_ACTION` via `publishAdminAction` on the destructive admin routes); analytics handlers
  subscribe centrally. Never call analytics directly from a route.
- **← `middleware.ts`**: upstream contract for `x-user-id` / `x-mode` / `x-view` / `x-request-id`.
  Anything not in the middleware allowlist is session-gated before the handler ever runs, which is why
  several routes carry no in-route auth.
- **← tests**: `frontend/test/harness/mock-fetch.ts` mounts these real handlers in-process for the `node` Vitest
  project, and `frontend/test/qa/*.spec.ts` drives them through a real browser in tutorial mode. Route handlers
  are imported and called directly in `app/**/__tests__/*.test.ts`.

## Gotchas

- **`api/query` returns 400 for query failures, not 500.** The client's `parseErrorMessage` and
  `captureError` both key off that. Changing it to `handleApiError` would start paging the team on every
  user typo.
- **Whitelist validation and view resolution are no longer this route's own code.** Both live in
  `resolveQueryForExecution` (`lib/sql/governed-query.server.ts`), which the agent's `ExecuteQuery` and
  the MCP server call too — they had each independently forgotten a step. The ordering it enforces is
  the one this route established: a view is authorized as itself (it appears in the whitelisted schema,
  so it can expose an aggregate over tables the reader can't query directly — its own SQL is validated
  where it is *authored*), and the cache key is computed over the *resolved* SQL, so editing a view body
  invalidates results for free. Non-view queries take a byte-identical fast path and are never parsed.
  The route passes `{kind:'file', path: filePath}` as the anchor: a question is governed by the nearest
  context to ITS path. **With no `filePath` there is no anchor and the query is ungoverned** (long-standing
  behaviour, unchanged) — the route still inlines views in that case so a `_views` reference cannot reach
  the warehouse as a nonexistent table.
- **`forceRefresh` is ignored for guests** — public shares stay cache-served so they can't be used to
  hammer the warehouse.
- **`api/validate-sql` calls `FilesAPI.loadFile` on the connection** — the exact schema-profiling call
  `api/query` was changed to avoid. It is off the hot path, but do not copy the pattern.
- **`turns` claims the lease before returning.** Reordering this so the detached runner claims it lets a
  client open the stream and see a premature `idle`, or a heartbeat-less `running` that reads as
  orphaned. For an `autoRetry` the *old* `runStartedSeq` is preserved — overwriting it with `maxSeq+1`
  would point the truncate past the crashed rows.
- **A `stream` setup failure looks like success.** The route returns the SSE `Response` immediately and
  drives catch-up/subscribe in a detached async IIFE whose `.catch()` only logs and closes the writer.
  A failure there reaches the client as a 200 SSE stream that ends with zero events — no error status,
  no `AppEvents.ERROR`.
- **Stream liveness is polled, not just notified.** A NOTIFY only fires while the owner process is alive,
  so `stream` re-checks the lease every 15 s; without that a reconnect onto an already-dead turn would
  tail forever. Correctness is the cursor plus the catch-up SELECT — a dropped NOTIFY is harmless.
- **Reads and mutations use different predicates on conversations.** `canReadConversation` admits any
  admin by direct id; `ownsConversation` (DELETE/PATCH) and the inline owner+mode checks
  (turns/interrupt/fork/screenshots/remote-session) do not. Verified by
  `api/conversations/[id]/__tests__/admin-read-access.test.ts`.
- **Both LLM-log routes are admin-only, and must stay that way.** `api/llm-calls/[callId]` and
  `api/conversations/[id]/llm-calls` serve raw pi-format blobs containing full system prompts and
  conversation content. The single-call route shipped with NO role check — middleware requires a
  session, so any logged-in role could read any call by id, since a call id is the only input.
  Gated now, with `app/api/llm-calls/[callId]/__tests__/route.test.ts` pinning viewer, editor and
  unauthenticated all to 403.
- **`api/files/batch` intentionally bypasses `appEventRegistry.publish(FILE_VIEWED)`** in favour of one
  batched `trackFileEvents` insert. Per-file event publish (and its webhook fan-out) is dropped on
  purpose for bulk loads; restoring it reintroduces the N+1 insert storm.
- **`revalidateTag('configs', 'default')` takes two arguments.** That is the Next 16 signature (tag +
  cache profile), not a stray parameter. Same for `revalidateTag('database-schema', 'default')`.
- **`withCronAuth` answers a bad secret with `200 {ok:true}`.** Do not read a 200 from `api/jobs/cron` as
  proof that the scan ran.
- **The MCP session map lives on `globalThis`** to survive HMR; a dev-server restart drops every live MCP
  session.
- **`middleware.ts` still allowlists `/api/public/slack-chart`, which no longer exists.** Harmless, but
  do not treat the allowlist as an inventory of real endpoints.
- **`E2E_MODE` gating is a runtime 404, not a build exclusion** — `api/test/faux/*` files ship in the
  production bundle and answer 404. `api/test-error` behaves the same way behind `IS_DEV`.
- **QA flows must carry `mode=tutorial` on every request.** The system default is `org`; a missing mode
  parameter silently writes to production data.

## Key files

| Task | File |
|---|---|
| Response/error envelope, `ApiErrors`, `handleApiError` | `frontend/lib/http/api-responses.ts` |
| Session/cron auth wrappers | `frontend/lib/http/with-auth.ts` |
| Bearer auth + rate limit for `/s/<code>/*` | `frontend/lib/http/with-remote-session-auth.ts` |
| Header stamping, public allowlist, impersonation, mode | `frontend/middleware.ts`, `frontend/lib/middleware/create-middleware.ts` |
| The 500-shape lint rule (`app/api/**` only) | `frontend/eslint.config.mjs` |
| Query execution order, guest guard, cache headers | `frontend/app/api/query/route.ts` |
| Chat turn start (detached run, lease, remote guard) | `frontend/app/api/conversations/[id]/turns/route.ts` |
| Resumable SSE, stale-lease recovery | `frontend/app/api/conversations/[id]/stream/route.ts` |
| File CRUD + the PATCH move/save overload | `frontend/app/api/files/[id]/route.ts` |
| SSR preloadedState, telemetry stamp, wizard redirect | `frontend/app/layout.tsx` |
| External-agent protocol contract (the skill doc itself) | `frontend/app/s/[code]/route.ts` |
| MCP transport + session store | `frontend/app/api/mcp/route.ts` |
| Proof the query path never profiles schemas | `frontend/app/api/query/__tests__/query-route-no-profiling.test.ts` |
| Proof of whitelist → views → cache ordering | `frontend/app/api/views/__tests__/query-route-views.test.ts` |
| Proof of admin-read vs owner-mutate asymmetry | `frontend/app/api/conversations/[id]/__tests__/admin-read-access.test.ts` |
| End-to-end turn POST + stream GET + interrupt | `frontend/app/api/conversations/[id]/__tests__/stream-turns.test.ts` |

---
