# Jobs, integrations and telemetry

Scheduled and manual job runs, the Slack/MCP surfaces, message transports and analytics:
`lib/jobs`, `lib/integrations`, `lib/messaging`, `lib/analytics` — plus the four leaves these
four drive: `lib/app-event-registry` (the bus everything publishes into), `lib/mcp`, `lib/search`
and `lib/spreadsheet`.

The browser-side tool bridge has its own doc: `frontend/lib/tools/CLAUDE.md`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## Jobs, Integrations & Telemetry

Eight modules under `frontend/lib/` that sit at the app's edges: the scheduled-job runner,
the Slack and MCP surfaces, outbound messaging, search/spreadsheet leaves, and the
event/analytics pipeline every other module publishes into.

### What each module owns

**`lib/jobs/`** — scheduled and manual runs of `alert` / `context` / `report` / `sheets_sync`
job files: cron evaluation, run-file creation, handler dispatch, and message delivery
hand-off. It does not own what a job *does* (that's `lib/evals/server`, `lib/chat/run-report.server.ts`,
`lib/csv-processor`) nor the transport (that's `lib/messaging`). It does not own scheduling:
an external scheduler POSTs `/api/jobs/cron` once a minute; nothing here holds a timer.

**`lib/integrations/slack/`** — the whole Slack surface: OAuth install + HMAC state, bot/channel
config persisted in the org config document, event dedup, Slack Web API calls, markdown→mrkdwn
and Block Kit rendering, and the thread↔conversation mapping. It does not own the agent — it
calls the same `runConversationTurn` the browser uses.
It also owns one thing that is not obviously Slack's: recording which namespace a `team_id` belongs to.
A Slack event webhook arrives with no session and no identifying host — only the team id — so resolving
it has to happen *before* any request context exists, which means it cannot read namespace-scoped
storage. Install time is the one moment both values are known, so `upsertSlackBotConfig` /
`removeSlackBotConfig` call `syncTeamBinding`, which is `bindExternalId('slack_team', …)` /
`unbindExternalId`. The bind is best-effort and re-runs on re-install: the config write is what the
user asked for, so a binding failure is logged and swallowed rather than failing the install. The
events route then passes `hints: { slack_team: teamId }` to `resolve()`; a known team runs inside
`with()`, a team id that resolves to nothing is acked `{ok: true}` and dropped (guessing is worse than
losing an event), and a payload with no team id at all proceeds with no namespace established.
`lib/integrations/slack/__tests__/namespace-binding.test.ts` pins all five behaviours.

**`lib/messaging/`** — outbound message transports (config-declared HTTP webhooks with
`{{VAR}}` substitution, plus email/OTP HTML builders), client-side error reporting, and the
server-side unhandled-rejection router (`unhandled-rejection-logger.ts`, wired from `runBootTasks()`
in `lib/instrumentation/register-modules.ts`, not from `instrumentation.ts` — that file returns early
for a deployment supplying its own module set, so anything wired after the branch had to be
re-implemented verbatim). It does not own *who* to notify
(job handlers build recipient lists) and does not own the event bus.

**`lib/app-event-registry/`** — a synchronous-publish / fire-and-forget in-process pub/sub. It
owns the typed event catalogue (`events.ts`) and the single place handlers are subscribed
(`index.ts`). Business logic never calls an analytics function directly; it publishes.

**`lib/analytics/`** — two unrelated halves. (a) Server-side telemetry tables in the **document
DB** (`file_events`, `llm_call_events`, `llm_logs`, `queries`, `query_execution_events`,
`feedback_events`, `app_events`) plus the credit accounting built on `llm_call_events`.
(b) A client-side Mixpanel/noop provider plus a Redux middleware that mirrors *every* dispatched
action to it. There is **no DuckDB here** — `file-analytics.db.ts` writes through
`getModules().db`, the same Postgres/PGLite adapter as the document store.

**`lib/mcp/`** — a per-session MCP server bound to one OAuth-authenticated user, exposing
read-only tools. It does not own OAuth token issuance (`lib/oauth/`) and cannot write files.

**`lib/search/`** — pure ranking/snippet logic for file search and database-schema search,
plus the schema-result size cap. No DB access of its own beyond `FilesAPI`.

**`lib/spreadsheet/`** — direct-data ("spreadsheet") question sources: validation,
materialization into a `QueryResult`, and a content-addressed cache identity that reuses the
existing query-result key space so viz/projection need no second store.

### Architecture

**Frontend-bridged tool call** — the browser-side half of the tool loop lives in
`frontend/lib/tools/`, which has its own `CLAUDE.md` covering the bridge, the handler
registry and the review/rubric path.

**Job run**

```
external scheduler ──POST /api/jobs/cron──► runForOrg(now)          lib/jobs/cron-scan.ts
                                              for each JOB_DEFINITIONS entry
                                                FilesAPI.getFiles(type) → isActive → suppressUntil
                                                getCron(content) → getPrevFireTime  lib/jobs/cron.ts
                                                JobRunsDB.findOrCreate(window_start=prevFire)  ← dedup
                                                create run file (status:'running')
                                                JOB_HANDLERS[job_type].execute(...)
                                                save run file + deliverMessages(...)
                                                JobRunsDB.complete(SUCCESS|FAILURE)
                                            ──► runCreditResets(now)  lib/jobs/credit-reset.ts

user ──POST /api/jobs/run──► runJob(...)   lib/jobs/run-job.ts   (same body, one job, source:'manual')
```

`lib/jobs/job-runs-state.ts` is the client mirror of that surface (fetch history → Redux
`jobRunsSlice`, trigger a run, select a run) and is the only place components should reach for.

**Slack turn**

```
Slack ──► POST /api/integrations/slack/events   (signature verify + reserveSlackEvent)
            └─ processSlackEvent()                       lib/integrations/slack/process-event.ts
                 addReaction :eyes:
                 getSlackUserEmail → getUserEffectiveUser → checkCreditGate
                 getOrCreateSlackConversationId (meta.slackThreadKey)    slack/store.ts
                 buildSlackAgentArgs (app_state: {type:'slack'})         slack/context.ts
                 runSlackChatTurn → runConversationTurn                  slack/run-turn.server.ts
                 extractSlackReply / extractQueryCharts (legacy log)     slack/messages.ts
                 uploadSlackFile(charts) → postSlackMessage(blocks)
                 :eyes: → :white_check_mark:  (or :x: on throw)
```

**Event pipeline** — one publish fans out to specific handlers *and* a global sink:

```
appEventRegistry.publish(AppEvents.X, payload)          registry.ts (never awaited, never throws)
   ├─ specific subscribers (index.ts)  → file_events / query_execution_events / feedback_events
   │                                   → reportErrorToSentry (ERROR only)
   └─ subscribeAll sink (index.ts)     → enrichEventPayload (request path, referer, user)
                                          ├─ recordAppEvent  → app_events (JSONB payload)
                                          └─ forwardToWebhooks → EVENTS_FORWARD_RULES regex match
                                               hooks.slack.com → {text: "*type*\n• k: v"}
                                               anything else   → raw enriched JSON
```

### Interactions with other areas

| Boundary | Contract |
|---|---|
| `app/api/jobs/{cron,run}/route.ts` → `lib/jobs/` | Routes are thin: auth (`withCronAuth` / `withAuth`), `JobRunsDB.ensureTable()`, then `runForOrg` / `runJob`. Outcomes are returned as a discriminated union (`RunJobOutcome`), never thrown. |
| `lib/jobs/handlers/*` → other areas | `alert`/`context` → `createServerRunner` (`lib/evals/server`); `report` → `runReportV2` + `buildServerAgentArgs`; `sheets_sync` → `lib/csv-processor` + `mergeReimportedSheetFiles`. All four return `{output, messages, status?}` — a handler reports failure by returning `status:'failure'`, it does not have to throw. |
| `lib/jobs/deliver-messages.ts` → `lib/messaging` + Slack | Resolves `config.messaging.webhooks` through `resolveWebhook`, then dispatches per `msg.type`. `slack_app_alert` bypasses webhooks entirely and posts via the installed bot token (resolved from its `@SECRETS/…` ref by `resolveConfigSecrets`). Mutates each `RunMessageRecord` in place and never throws. |
| Everything → `lib/app-event-registry` | Publishers include `lib/data/files.server.ts` (FILE_*, incl. moveFile), `lib/data/configs.server.ts` (CONFIG_UPDATED), `lib/data/connections.server.ts` (CONNECTION_*), `lib/data/shares/shares.server.ts` (SHARE_CREATED/REVOKED), `lib/http/with-auth.ts` (ERROR), `app/api/query/route.ts` (QUERY_EXECUTED), `lib/chat/tracked-orchestrator.server.ts` + `lib/chat/headless-llm-tracking.server.ts` (LLM_CALL), `lib/chat/conversation-turn.server.ts` (CHAT_TURN, browser USER_MESSAGE, turn ERROR), `lib/auth/auth-factory.ts` (USER_LOGGED_IN), `app/api/users/**` (USER_CREATED/UPDATED/DELETED), `app/api/share/guest-session/route.ts` (SHARE_OPEN/LEAD), the destructive admin routes via `publishAdminAction` (ADMIN_ACTION), plus this area's `slack/process-event.ts`, `mcp/session-logger.ts`, `jobs/cron-scan.ts`, `jobs/credit-reset.ts`, `analytics/credit-usage.server.ts`. Contract: `publish` is void and fire-and-forget — you cannot await the write. |
| `lib/chat/tracked-orchestrator.server.ts` → `lib/analytics` | The factory every production orchestrator is built through: installs `creditEnforcer(user)` as the orchestrator's `beforeLlmCall` hook (throws `CreditLimitError` on an enforced over-limit user), and its `recordUsage` `await`s `recordLlmCallEvent` / `recordLlmResponse` **directly** rather than via the registry, because a standalone prod build does not keep unawaited promises alive past the response. |
| `lib/mcp/server.ts` → data/search/connectors | Reuses `FilesAPI`, `ConnectionsAPI.getRawByName`, `getNodeConnector`, `readFilesServer`, `searchDatabaseSchema`, `searchFilesInFolder`, `getWhitelistForUser` + `validateQueryTables`, and `buildServerAgentArgs` — the same primitives the in-app agent uses, so MCP impersonates the user's context exactly. |
| `lib/spreadsheet/` → viz/query cache | `getSpreadsheetExecution(source)` returns `{query: 'spreadsheet:<hash>', params: {}, database: ''}`; `cacheSpreadsheetSource` dispatches `setQueryResult` under exactly that key. Consumers (`QuestionContainerV2`, `lib/file-state/file-read.ts`, `lib/chat/compress-augmented.ts`, `lib/data/helpers/param-resolution.ts`) resolve a question's source through `getQuestionExecution`, which is the single place `spreadsheet` and `query` are disambiguated. |
| `lib/branding/whitelabel.ts` → `lib/analytics/credit-policy.ts` | `OrgConfig.credits` is typed as `CreditsConfig`, so the settings UI, the gate, and the aggregation all read one shape from the org config document. |

### Gotchas

- **`appEventRegistry.publish` is unawaitable.** It returns `void` and swallows handler
  rejections into a `console.error`. Anything that must be durable before a response returns
  has to be awaited directly — that is exactly why `recordLlmCallEvent` is not an event handler.
- **A publish with no specific subscriber is not a no-op.** The `subscribeAll` sink still stores
  it in `app_events` and fans it to matching webhooks. Most of the catalogue — everything except
  `FILE_*`, `QUERY_EXECUTED`, `FEEDBACK` (typed-table subscribers) and `ERROR` (Sentry) — reaches
  only that sink. `lib/app-event-registry/__tests__/catalogue-coverage.test.ts` asserts every
  declared event has at least one publisher, so declared-but-never-published drift fails CI.
- **Handler registration lives in `lib/app-event-registry/index.ts` and runs on first import of
  that barrel.** Importing `./registry` gets the same process-wide singleton but does not itself
  wire the subscribers, so publish through `@/lib/app-event-registry` rather than relying on
  another module having imported the barrel first.
- **`analyticsMiddleware` is in the store's middleware chain** (`store/store.ts`) and
  `BLACKLISTED_ACTIONS` is empty, so with Mixpanel configured every Redux action — with its
  full payload — is sent as `Redux/{slice}/{action}`. Blacklist patterns are the intended
  throttle; there are none today.
- **`handleApiError` does not report errors.** The route wrapper `withAuth`
  (`lib/http/with-auth.ts`) is what publishes `AppEvents.ERROR`, skipping client aborts
  (`isClientAbortError`) and rethrowing. `handleApiError` only shapes the response.
- **Cron dedup is the run row, not a lock.** `JobRunsDB.findOrCreate(window_start = prevFire)`
  is what stops a double fire; a job whose previous scheduled fire was more than one hour ago
  is skipped outright (`MAX_CRON_DELAY_MS`), so an outage does not retro-fire stale dailies.
- **Cron scanning ignores time zones; credit resets don't.** `cron-scan.ts` calls
  `getPrevFireTime(cronExpr, now)` with no zone, i.e. server-local time. `credit-reset.ts` passes
  the configured `resetTimeZone` (default `America/Los_Angeles`). Same evaluator, different
  effective schedule.
- **Cron-created run files are always typed `alert_run`**, hardcoded in `cron-scan.ts`, even for
  `report` / `context` / `sheets_sync` jobs. The manual path (`run-job.ts`) uses
  `` `${job_type}_run` ``. Anything filtering run files by type sees the two paths differently.
- **The cron path deliberately skips `slack_alert` delivery** (`skipTypes: ['slack_alert']` in
  `cron-scan.ts`) — those messages stay `pending` forever. `run-job.ts` delivers them. The
  in-code comment marks this as a known latent bug preserved on purpose.
- **`send: false` and `skipTypes` are different.** `send:false` marks *every* message `skipped`;
  `skipTypes` leaves the message untouched at `pending`.
- **Slack event dedup is in-memory and per-process** (a 500-entry `Set` in `slack/store.ts`,
  carrying an ESLint disable for the module-level-`Set` rule). It is lost on restart and is not
  shared across instances. `markSlackEventDone` is a no-op kept for API symmetry.
- **Slack is headless by construction.** There is no browser to bridge frontend tools to, so
  `runSlackChatTurn` always sends a fresh `user_message` turn and `setupOrchestration` swaps in
  `HEADLESS_REGISTRABLES` for `SlackAgent`. `extractSlackReply` reads only *this turn's* new
  rows (captured via `startSeq` before the turn) so an old answer can't be re-posted.
- **`SlackAgent` declares no tools of its own** — it extends `RemoteAnalystAgent` and inherits its
  DB + file toolset, overriding only the system prompt (`slack_addendum`) and `llmAgent = 'slack'`.
  What it *does* own is which log rows count as a reply: `AGENT_TOOL_NAMES` in `slack/messages.ts`
  is `['TalkToUser', 'AnalystAgent', 'AtlasAnalystAgent', 'SlackAgent']`, scanned backwards from
  the newest `task_result`. `TalkToUser` is in that list for old logs only — no agent registers
  such a tool today.
- **Credit windows are named twice.** `credit-policy.ts` resolves `daily` and `weekly`; the
  aggregation maps `weekly → billing` and `daily → reset` (`credit-usage.server.ts`). A manual or
  automatic `CREDIT_RESET` app event moves the window start forward via `resetFloorExpr` — usage
  is floored at `GREATEST(calendar-start, latest applicable reset)`, so the reset feature is
  implemented as a *query* over `app_events`, not a mutation of stored usage.
- **`resolveCreditConfig` and the allowance fields in `credit-budgets.ts` are test-only.**
  Production reads exactly three of `CreditConfig`'s fields — `weights`, `defaultBillingCycle`,
  `maxBillingCycleDays`; the rest are consumed only by `resolveCreditConfig`, whose only importer
  is `lib/analytics/__tests__/credits.test.ts`. Real limits come from the `credits` section of the
  org config document, resolved per user by `credit-policy.ts` (user → role → company → built-in
  `DEFAULT_DAILY_LIMIT` 1000 / `DEFAULT_WEEKLY_LIMIT` 5000).
- **Managed-gateway calls bill from a cost the *provider* reports, not from local rates.** pi-ai
  normally computes `local_rate × wire_tokens`, which cannot work for the gateway: it picks the model
  server-side per request, so the client has no rate to multiply and `buildCustomModel` zeroes them.
  Left alone, every managed call records `cost = 0` in `llm_logs`, `costToCredits` sees nothing,
  credits never accrue, and no test goes red. The gateway therefore returns its own cost in the usage
  object (OpenRouter's `usage.cost` convention — the OpenAI usage object has no cost field), and
  `frontend/patches/@earendil-works+pi-ai+0.80.6.patch` makes pi-ai honour it.
  `frontend/lib/llm/__tests__/gateway-cost.test.ts` drives a real local HTTP server speaking that exact
  wire format through the real `streamSimple`, so the patch is what is under test rather than a
  re-implementation of it; it pins that a malformed cost is ignored rather than corrupting the total,
  and that a reported `0` is a real value and not a fallback trigger. **Dropping the patch on a pi-ai
  bump silently zeroes managed-workspace billing.**
- **`SEARCH_CONFIGS` in `lib/search/file-search.ts` is an allow-list, and a missing entry fails
  silently** (`if (!config) continue`). It covers nine types today — `question`, `dashboard`,
  `story`, `notebook`, `connection`, `context`, `report`, `alert`, `folder`. The system types
  (`config`, `styles`, `session`, `users`, `explore`, and the `*_run` outputs) are deliberately
  absent, so they are unfindable via `SearchFiles`. **Adding a searchable file type means adding a
  row here** — nothing fails or warns if you forget.
- **`capSchemaResult` exists because one schema can exhaust the context window.** A wide
  warehouse serializes to millions of characters and the whole conversation is re-sent every
  turn; the cap keeps whole tables in order up to `SCHEMA_RESULT_MAX_CHARS` (60k) and annotates
  the truncation. The MCP `SearchDBSchema` tool does **not** apply it — only
  `agents/benchmark-analyst/db-tools.ts` does.
- **`captureError` dedups per tab for 60s and retries with backoff** (5 attempts,
  `lib/messaging/capture-error.ts`). It is in-memory only: a reload drops pending retries. It
  never throws — an error reporter that throws recurses.
- **`isSpreadsheetSource` is a structural guard, not a type assertion.** Persisted content may
  predate validation or be agent-authored; the declared type is never trusted.
- **ESLint gates that bite in these files:** no dynamic `import()` / `require()`, no direct
  `process.env` (use `lib/config.ts` or `lib/constants.ts`), and no module-level `Map`/`Set`
  without an inline justification — the disables in `capture-error.ts`, `slack/store.ts` and
  `slack/messages.ts` are that rule. API routes additionally cannot return
  `NextResponse.json(..., {status: 500})`. `lib/database/documents-db` is import-banned outside
  `lib/data/*.server.ts`, which is why everything here goes through `FilesAPI` / `ConnectionsAPI`
  / `getModules().db`.

### Key files

| Task | File |
|---|---|
| Add a job type | `frontend/lib/jobs/job-definitions.ts` + `frontend/lib/jobs/job-registry.ts` |
| Cron scan / dedup / run-file lifecycle | `frontend/lib/jobs/cron-scan.ts` |
| Manual run (`/api/jobs/run`) | `frontend/lib/jobs/run-job.ts` |
| Cron expression evaluation (with time zone) | `frontend/lib/jobs/cron.ts` |
| Message delivery dispatch | `frontend/lib/jobs/deliver-messages.ts` |
| Slack request handling end-to-end | `frontend/lib/integrations/slack/process-event.ts` |
| Slack Web API + signature verification | `frontend/lib/integrations/slack/api.ts` |
| Slack reply/chart extraction, mrkdwn, Block Kit | `frontend/lib/integrations/slack/messages.ts` |
| Slack bot config, channels, thread→conversation | `frontend/lib/integrations/slack/store.ts` |
| Add an app event | `frontend/lib/app-event-registry/events.ts` |
| Subscribe a handler to an app event | `frontend/lib/app-event-registry/index.ts` |
| Telemetry table writes | `frontend/lib/analytics/file-analytics.db.ts` |
| Credit math / gate / aggregation | `frontend/lib/analytics/credit-usage.server.ts` |
| Admin-configurable credit limits | `frontend/lib/analytics/credit-policy.ts` |
| Webhook transport + `{{VAR}}` substitution | `frontend/lib/messaging/webhook-executor.ts` |
| Route an unhandled rejection to its conversation | `frontend/lib/messaging/unhandled-rejection-logger.ts` |
| Event → webhook fan-out + enrichment | `frontend/lib/messaging/app-events-notifier.ts` |
| MCP tool surface | `frontend/lib/mcp/server.ts` |
| File / schema search ranking | `frontend/lib/search/file-search.ts`, `frontend/lib/search/schema-search.ts` |
| Direct-data question validation + cache key | `frontend/lib/spreadsheet/materialize.ts` |


---
