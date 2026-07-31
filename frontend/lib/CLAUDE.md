# Small shared lib modules

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

This doc auto-loads for **any** file under `frontend/lib/**`, so it opens with the routing table
that names the doc actually covering the directory you are in. The rest covers the leaf modules
with no owning subsystem: the file-type registry, the server/client config split, the managed
gateway, the published compatibility contract, white-label branding, the utils that carry a real
invariant, a few small modules with a sharp rule, the test/benchmark support, and `lib/og`.

Those leaves are leaves by design — almost all of them are imported by many areas and import
almost nothing themselves, so a change here has wide blast radius and no local test to catch it.

## Where a directory is documented

Module docs load lazily — when files in their own directory are read. Several docs cover sibling
directories, and each such directory carries a short pointer-stub `CLAUDE.md` naming its owner.
This table is the same routing map in one place.

| You are editing | Read |
|---|---|
| `orchestrator/**` | `frontend/orchestrator/CLAUDE.md` |
| `agents/**` | `frontend/agents/CLAUDE.md` |
| `lib/chat`, `lib/llm`, `lib/projection` | `frontend/lib/chat/CLAUDE.md` |
| `lib/sql` | `frontend/lib/sql/CLAUDE.md` |
| `lib/connections` | `frontend/lib/connections/CLAUDE.md` |
| `lib/query-cache` | `frontend/lib/query-cache/CLAUDE.md` |
| **`lib/data`**, `lib/database`, `lib/object-store`, `lib/secrets` | `frontend/lib/database/CLAUDE.md` |
| `lib/semantic`, `lib/context`, `lib/views`, `lib/validation` | `frontend/lib/semantic/CLAUDE.md` |
| `lib/viz`, `lib/chart` | `frontend/lib/viz/CLAUDE.md` |
| `lib/story-ui`, `lib/jsx` | `frontend/lib/story-ui/CLAUDE.md` |
| `lib/story-surface`, `lib/dashboard-surface`, `lib/html` | `frontend/lib/story-surface/CLAUDE.md` |
| `lib/screenshot`, `lib/headless-capture` | `frontend/lib/screenshot/CLAUDE.md` |
| `lib/auth`, `lib/http`, `lib/middleware`, `lib/mode`, `lib/namespace`, `lib/oauth`, `lib/rubric` | `frontend/lib/auth/CLAUDE.md` |
| `lib/tools` | `frontend/lib/tools/CLAUDE.md` |
| `lib/jobs`, `lib/integrations`, `lib/messaging`, `lib/analytics`, `lib/app-event-registry`, `lib/mcp`, `lib/search`, `lib/spreadsheet` | `frontend/lib/jobs/CLAUDE.md` |
| `lib/file-state`, `lib/hooks`, `lib/navigation`, `store/**` | `frontend/store/CLAUDE.md` |
| any other small `lib/*` module | `frontend/lib/CLAUDE.md` |
| `components/**` | `frontend/components/CLAUDE.md` |
| `app/**` | `frontend/app/CLAUDE.md` |
| `test/**`, `scripts/**`, `.github/**` | `frontend/test/CLAUDE.md` |

`lib/navigation` is the one entry with no stub of its own — it has no `CLAUDE.md`, so nothing
auto-loads when you edit it. Read `frontend/store/CLAUDE.md`.

## The file-type registry

`frontend/lib/ui/file-metadata.ts` is the single table every other area derives file-type facts
from. `FILE_TYPE_METADATA` is a `const satisfies Record<string, FileTypeMetadata>` object; the
`FileType` union is `keyof typeof FILE_TYPE_METADATA`, so adding a key adds a type everywhere.
`frontend/lib/types.ts` imports `FileType` from here and re-exports it — this file, not
`frontend/lib/validation/atlas-schemas.ts`, is where the type union originates.

Everything else in the module is derived, not declared:

```
FILE_TYPE_METADATA ─┬─ FileType                    (keyof)
                    ├─ SUPPORTED_FILE_TYPES        (filter supported)
                    │    └─ getSupportedFileTypes(override) ← OrgConfig.supportedFileTypes
                    ├─ .category === 'analytics'   → ANALYTICS_FILE_TYPES
                    ├─ .markers                    → markersEnabledForAppState (screenshots)
                    ├─ .h                          → view height ('none' = full page flow)
                    └─ .systemCreatedOnly          → hidden from the Create menu
```

Consumers span the app shell (`components/app-shell/CreateMenu.tsx`, `Sidebar.tsx`), the file
browser (`FilesList.tsx`, `FileSearchBar.tsx`), chat (`components/explore/ChatInterface.tsx`),
config validation (`frontend/lib/validation/config-validators.ts`) and the screenshot pipeline
(`frontend/lib/screenshot/app-state-screenshot.ts`).

`getSupportedFileTypes(override)` implements the *full-replace* override rule shared with
`accessRules`: a non-empty `OrgConfig.supportedFileTypes` replaces the built-in set entirely; an
empty or absent one falls back to defaults so a bad config can't disable file creation. The
override can also *enable* a type whose `supported: false` (notebook, report) — that flag is the
default, not a hard gate.

`markers` is the app-state-screenshot flag (numbered position gutter + `<Viewport>` pointer). It
carries a real invariant, enforced in `frontend/lib/screenshot/__tests__/app-state-screenshot.ui.test.ts`:
**every `markers: true` type must also be `h: 'none'`** — markers on an internally-scrolled view
(question) would number only the visible slice. The same test asserts `conversation` is absent
from the registry.

`frontend/lib/ui/fileComponents.tsx` is the sibling type→container map, consumed only by
`components/file-browser/FileView.tsx`. It is a `Partial<Record<FileType, …>>`: a type with no
entry renders the "Unsupported file type" message rather than failing. Today that is `users`,
`folder`, `explore` and `context_run`.

## Config vs constants: the server/client split

Two files, deliberately disjoint:

- `frontend/lib/config.ts` — `import 'server-only'`. Every server-side env var and secret, read
  once at module load into one `EnvironmentConfig` object and re-exported as named constants.
- `frontend/lib/constants.ts` — client-safe: `NODE_ENV` derivatives, `NEXT_PUBLIC_*`, build-stamped
  values, and pure helpers (`parseAnalyticsConfig`).

Three mechanisms hold the split:

1. **ESLint** — `no-restricted-syntax` bans `process.env` member access repo-wide; only
   `lib/config.ts`, `lib/constants.ts`, `scripts/**`, `test/setup/**` and the `next.config.ts` /
   `playwright*.config.ts` files are exempt (`frontend/eslint.config.mjs`).
2. **`server-only`** — importing `config.ts` from a client component is a build error.
3. **`frontend/lib/__checks__/config-constants-no-overlap.ts`** — a compile-time guard, no runtime
   code and no test: it computes `keyof typeof Config & keyof typeof Constants` and assigns `true`
   to a type that is `true` only when that intersection is `never`. A name exported from both files
   fails `tsc --noEmit`, i.e. `npm run validate`. It uses `import type` so it never trips the
   `server-only` runtime guard.

`config.ts` validation is deliberately soft: `requireSecret` returns a dummy in test, `''` in the
browser, and only accumulates a fatal error on a real server. The one required secret is
`NEXTAUTH_SECRET`; everything else has a default or is `| undefined`. `getOptionalNumber` treats
`''` and non-finite input as "unset", so `MAX_CONCURRENT_QUERIES=` falls back to `10` rather than
becoming `NaN`.

Two derived exports do real work rather than pass a value through:
`EVENTS_FORWARD_RULES` parses a JSON `{ "<event-type regex>": "<webhook url>" }` map and *skips*
invalid JSON or a bad regex with a `console.error` — a malformed rule never crashes boot; and
`ANALYTICS_CONFIG` is gated by telemetry level (below).

**Telemetry.** `frontend/lib/telemetry.ts` (outside this cluster but the direct upstream of
`config.ts`) defines the `off | errors | full` level. `config.ts` computes
`TELEMETRY_LEVEL = parseTelemetryLevel(MX_TELEMETRY)` and then gates product analytics on it:
`off` → nothing, `errors` → only an explicitly-set runtime `ANALYTICS_CONFIG`, `full` → also the
image-baked `NEXT_PUBLIC_DEFAULT_ANALYTICS_CONFIG` default. The browser side never reads env: the
root layout stamps `data-mx-telemetry` on `<html>` and `instrumentation-client.ts` reads it back.
`SEND_ERRORS_IN_DEV` and `IS_DEV`/`IS_TEST` come from `constants.ts` so the three Sentry init files
(server / edge / client) can share one gate.

The three gateway env vars (`MX_GATEWAY_ORIGIN`, `MX_GATEWAY_URL_PROXY`, `MX_GATEWAY_SHARED_SECRET`)
all live here rather than in `constants.ts` — see the `lib/gateway` section below.

## `compatibility.json` — the published support contract

`frontend/compatibility.json` is a static JSON contract with **three consumers that cannot import
each other**:

```
frontend/compatibility.json
   ├─ the app      → lib/llm/compat-models.ts (per-grade "Auto" model), connection form field specs
   ├─ install.sh   → curled from raw.githubusercontent.com; drives the setup interview prompts
   └─ the docs     → docs/components/compatibility-tables.tsx (supported databases / models)
```

It must live at `frontend/` (not the repo root) because the app imports it as `@/compatibility.json`
and the Docker image ships it.

`frontend/lib/compatibility/__tests__/compatibility.test.ts` is the only thing keeping the three in
agreement — the directory contains nothing else. It asserts: every `connections.types[].type` is a
real `CONNECTION_TYPES` entry; every non-coming-soon `external-engine` connector appears with
`cli: true`; declared field keys are the exact keys the connectors read; `password`-kind and
credential-shaped fields are `secret: true` (so `install.sh` prompts silently); every
`kind: 'registry'` LLM provider exists in the baked pi-ai registry and declares one resolvable
default per `LLM_GRADES`; and that retired keys (`models`, `recommended`, and the `analyst` /
`micro` / `max` grade names) have not reappeared. Adding a connector to
`frontend/lib/ui/connection-type-options.ts` in the `external-engine` group and forgetting
`compatibility.json` fails this test.

`connection-type-options.ts` is the app-side twin: the picker's grouping/copy
(`components/shared/ConnectionTypePicker.tsx`). Its `description` strings contain `{{agentName}}`
placeholders substituted from branding at render time.

## `lib/gateway` — the managed MinusX gateway

`frontend/lib/gateway/` is the whole client surface onto the hosted service that provides model
access for MinusX-operated workspaces. It holds no billing logic of its own: how plans, balances and
expiry work is the service's business, and `frontend/lib/gateway/gateway-types.ts` only describes the
shape that comes back (money is integer micro-USD throughout; `microToUsd` is the only conversion).
Self-hosted installs never use any of it.

**Three env vars address it, all in `config.ts` (`server-only`), never `constants.ts`** — the browser
never calls the gateway, so a client import is a build error rather than a silently-inlined default.
`MX_GATEWAY_ORIGIN` is the origin: one service, two planes — control plane (orgs, credits, status) at
its root, inference at its `/v1`. `MX_GATEWAY_URL_PROXY` is the full inference URL and *derives* from
the origin (`MX_GATEWAY_ORIGIN + '/v1'`), so staging is normally one variable: two that can disagree
eventually do, and the disagreement surfaces as an auth failure against a gateway that never minted
the key, a long way from its cause. It stays overridable because the single origin is a property of
the reverse proxy rather than of the gateway — behind it the two planes are separate services on
separate ports, so an install sharing a network with the gateway cannot reach both through one
address. Setting it says "these are genuinely two places", deliberately, rather than by forgetting to
keep a second variable in step. `frontend/lib/llm/__tests__/gateway-url.test.ts` pins the derivation,
the trailing-slash trim, and that an override already carrying `/v1` is not suffixed again. The
predecessor `MINUSX_GATEWAY_URL` is gone and has no effect anywhere.

**The switch is `MX_GATEWAY_SHARED_SECRET`, not the URL.** `gatewayEnabled()`
(`frontend/lib/gateway/gateway-client.server.ts`) checks `baseUrl()` too, but that returns
`MX_GATEWAY_ORIGIN`, which carries a production default and is therefore never empty — so the
predicate reduces to the secret alone, and `frontend/lib/gateway/__tests__/gateway-client.test.ts`
pins exactly that. The URL cannot be the gate because every install addresses that origin for
inference; the secret is issued by MinusX and a self-hosted install cannot obtain one. Naming the
gateway has to stay harmless on its own.

**Everything here is best-effort, and that is the design.** `registerCompanyWithGateway`
(`frontend/lib/gateway/gateway-register.server.ts`) runs at the tail of `AuthModule.register`, after
registration has already committed, so nothing in it may throw: an outage must leave a working
workspace whose admin configures a provider by hand, not a half-registered one that can never be
registered again. A refusal is `console.warn`ed loudly at both layers, because everything downstream
of a failure is a non-event — no gateway config is written, the plan resolver falls back to whatever
else is configured, the settings panel renders nothing — which reads as "the feature is broken"
unless the reason is in the log.

**The credentials are returned exactly once.** `createGatewayOrg` yields `orgId` / `keyId` (public
ids) plus `orgSecret` (manages the account) and `key` (the inference credential); neither secret can
be read back, which is why registration persists them in the same step. They land under the `gateway`
key of the workspace config document, and extract-on-write moves both into the secrets store as
`@SECRETS/…` refs. The `llm` section written alongside points **every** grade at the provider —
wiring only `core` would leave a new workspace on "no model configured" for the other two — and
deliberately writes **no** `baseUrl`: that document is persisted forever, so a pinned URL (an internal
container hostname, say) would outlive every later change of address. Inference resolves from
`MX_GATEWAY_URL_PROXY` instead, derived from the same origin the client registered against.

**The service's vocabulary crosses the wire unchanged.** `createGatewayOrg`, `POST /orgs`, `org_id` /
`org_secret`, the `x-mx-org-secret` and `x-mx-shared-secret` headers, the config key `gateway.orgId`
and the entry point `registerCompanyWithGateway` are the *gateway's* names, not rename debt — do not
"fix" them. The app's own vocabulary is workspace, and that is what the props carry: `workspace_name`,
`app_url` and `app_commit` are sent on every registration, always all three, because support has an
org id and nothing else to go on. The `localhost` / `unknown` defaults are themselves the signal — an
absent key would read as an older client.

`fetchOrgStatus` / `fetchOrgUsage` gate on `baseUrl() && orgSecret` rather than `gatewayEnabled()`, so
a workspace with stored credentials keeps its settings panel working on a host that carries no shared
secret in its environment.

## Branding / white-label

`frontend/lib/branding/whitelabel.ts` owns the `OrgConfig` shape (branding, links, messaging
webhooks, `accessRules`, `supportedFileTypes`, `allowedVizTypes`, `chartColorPalette`, `setupWizard`,
`bots`, `credits`, `llm`, `gateway`, `remoteAgentsEnabled`), the `DEFAULT_CONFIG` fallback, the `DEFAULT_STYLES`
CSS, and `mergeConfig`. It owns *no* loading and *no* Redux: `frontend/lib/data/configs.server.ts`
reads the org config document, validates it, and calls `mergeConfig(DEFAULT_CONFIG, dbContent)`;
`app/layout.tsx` and `app/login/page.tsx` fall back to `DEFAULT_CONFIG` when there is no document;
`frontend/lib/database/import-export.ts` and `app/api/admin/reset-tutorial/route.ts` substitute
`DEFAULT_STYLES` into the seed template.

Merge semantics, and they differ per field:
- `branding` / `links` — key-wise shallow merge, with **empty strings filtered out** so a blank form
  field falls back to the default instead of blanking the brand.
- `thinkingPhrases`, `supportedFileTypes`, `chartColorPalette` — override wins only when non-empty
  (empty array = "unset").
- everything else — `overrides.x ?? defaults.x`.

**`mergeConfig` enumerates every `OrgConfig` key by hand.** Add a field to the interface, forget
`mergeConfig`, and it type-checks and is silently dropped on every config load. This is the exact
"explicit key enumeration" smell the repo bans elsewhere; there is a regression test for one such
drop (`lib/secrets/__tests__/config-secrets-e2e.test.ts` — "mergeConfig must not drop llm"). When
adding an `OrgConfig` field, update `mergeConfig` in the same edit.

**`gateway` is currently one of those drops.** `OrgConfig` declares it; `mergeConfig` does not
enumerate it, so any merged config loses it. This is latent rather than broken only because the one
reader — `app/api/gateway/status/route.ts` — uses `getRawConfig`, which returns the stored document
without merging. Route anything new that needs `gateway` the same way, or fix `mergeConfig` first.

`story-theme-options.ts` and `story-template-options.ts` are pure *projections* of registries owned
elsewhere (`lib/data/story/story-themes.ts`, `lib/data/story/story-templates.ts`) into the option
cards the frontend Clarify handler shows for `type: 'design'` / `type: 'template'`. They add only
the image-URL convention (`public/story-themes/<name>.png`,
`public/story-templates/<name>.svg`) and deliberately drop the templates' fat `guidance` field so it
never travels through picker props or the clarify stash.

`frontend/lib/ui/theme.ts` is the Chakra design system (`system`), consumed by
`components/app-shell/Providers.tsx`, `app/global-error.tsx`, `components/views/shared/StoryEmbeds.tsx`
and the test render helper. It covers the app-shell/admin surfaces only — rendered documents are on
the Tailwind kit. One asymmetry lives between it and `ACCENT_HEX` in `file-metadata.ts`:
`accent.info` exists as a raw *light-mode* token with **no semantic token** (so `color="accent.info"`
does not resolve) yet has an `ACCENT_HEX.info` entry. `ACCENT_HEX` exists because Lexical mention
nodes style with raw hex, not Chakra tokens; `ACCENT_TOKEN_HEX` is the `'accent.*' → hex` map that
`components/chat/MentionChip.tsx` and `components/lexical/MentionNode.tsx` both read.

## Utils that carry a contract

- **`utils/semaphore.ts`** — counting semaphore whose limit may be a **getter**, re-read on every
  acquire, so a Redux-hydrated runtime cap changes concurrency without recreating the instance. The
  release path hands the slot directly to the next waiter (active count unchanged) and only
  decrements when nobody waits; `run()` releases in `finally`, so a throwing task cannot leak a
  slot. Real users: `querySemaphore` in `frontend/lib/file-state/query-results.ts` (caps in-flight
  `/api/query` calls at `MAX_CONCURRENT_QUERIES`) and `frontend/lib/headless-capture/manager.ts`.
- **`utils/immutable-collections.ts`** — `immutableSet` / `immutableMap`. ESLint bans module-level
  `new Map()` / `new Set()` (they are shared across all requests on the server); the rule's selector
  matches `NewExpression`, so these helper *calls* pass without an eslint-disable. Use them for
  constants; keep the disable-with-justification for genuinely mutable module state.
- **`utils/query-hash.ts`** — `cyrb53`, a sync 53-bit hash that must produce identical output on
  client and server, because `getQueryHash(query, params, database)` is the Redux/query-result cache
  key computed on both sides (`store/queryResultsSlice.ts`, `app/api/query/route.ts`,
  `lib/query-cache/execute.server.ts`, `lib/data/helpers/param-resolution.ts`). `hashContent` is the
  same hash over `JSON.stringify(value)` and is used as the `editId` for DocumentDB writes — key
  order therefore matters to the hash.
- **`utils/error-recovery.ts`** — the auto-recovery policy behind `app/error.tsx`. Per error
  *message*: up to `MAX_AUTO_RESETS` (2) resets within a 5-minute window → one hard reload, guarded
  in `sessionStorage` for 10 minutes → `fallback` (manual UI). The reload step matters because
  `reset()` re-runs the JS already in the tab, so a stale tab can never pick up a fixed deployment
  without a full reload. **Failure contract: no storage, or storage that throws (privacy mode),
  returns `fallback`, not `reload`** — a reload it cannot record risks a reload loop. Occurrences
  further apart than the window are treated as sporadic and keep resetting.
- **`utils/xml-parser.ts`** — splits `<thinking>` / `<answer>` and strips `<suggested_questions>` /
  `<trust_info>` blocks. Shared by the chat Markdown renderer and the Slack integration
  (`lib/integrations/slack/messages.ts`) so both parse identically. Returns `null` when no tags are
  present (untagged content is all answer). Partial content after an unclosed opening tag is emitted
  immediately so streaming stays visible.
- **`utils/attachment-extract.ts`** — PDF/DOCX/TXT text extraction for chat attachments, and the one
  sanctioned exception to the no-dynamic-import rule: `pdfjs-dist` (~40 MB) and `mammoth` are
  `await import`ed inside their extractors with an inline eslint-disable, because a static import
  would pull them into every page that renders `ChatInput`. Limits are hard errors, not truncation:
  >10 PDF pages or >5000 words throws.
- **`utils/mentions.ts`** — `splitMentions` over the `@{…json…}` form; the regex is deliberately
  lazy and must stay in sync with `components/lexical/mention-transformer.ts`. Unparseable JSON
  degrades to plain text.
- **`utils/database-selector.ts`** — one selection rule ("preferred if present, else first, else
  `''`") over any object carrying `databaseName` / `name` / `metadata.name`, shared by chat, the
  notebook view and `lib/data/files.server.ts` so client and server pick the same default database.
- **`utils/toast-helpers.ts`** — `showAdminToast` reads Redux directly (`getStore()`); non-admins see
  nothing, and error/warning toasts additionally require devMode. Silent by design.
- **`utils/error-utils.ts`** (hydration-error classifier, used to suppress error reports),
  `utils/today.ts` (`todayISO()` for the `current_date` prompt var), `ui/animations.ts` (shared
  keyframe strings) and `ui/sidebar-sections.ts` (right-sidebar section titles/icons) have no
  contract beyond their signature.

## Small modules with a sharp rule

- **`frontend/lib/view/view-types.ts`** — `view` is a top-level URL param, preserved across
  navigation like `mode`. It is an **ordered** enum (`full → file → content → contentonly`), each
  level stripping strictly more chrome, so consumers must use the threshold helper `viewAtLeast`,
  never equality. Read by the middleware (`lib/middleware/create-middleware.ts`),
  `lib/auth/auth-helpers.ts`, `store/authSlice.ts` and the layout/file components.
- **`frontend/lib/dashboard/effective-params.ts`** — the dashboard parameter merge extracted from
  `components/views/DashboardView.tsx` so it is testable without a DOM. Precedence is
  `lastExecutedParams` → dashboard `paramValues` → the question's saved default → `''`, and
  membership is tested with `in`, never `??`: an explicit `null` (None) or `''` at a higher tier is
  a real value that a question default must not resurrect.
- **`frontend/lib/store/file-selectors.ts`** — pure, side-effect-free Redux selectors
  (`selectAugmentedFiles`, `selectAugmentedFolder`, `selectFilesByCriteria`, `selectFileByPath`)
  paired with the async loaders in `lib/file-state/`. `selectAugmentedFiles` memoizes on
  `(fileIds.join(','), state identity)` — a module-level `Map` with an explicit eslint-disable —
  purely to keep react-redux from warning about new references. `selectAugmentedFolder` applies
  permission (`canViewFileType`) and hidden-system-path filtering, so it is a *narrowing* view of
  Redux, not a mirror. Imported by hooks, tool handlers (`lib/tools/handlers/edit-file.ts`,
  `lib/tools/micro-task.ts`), `store/appStateSelector.ts` and the share page.
- **`frontend/lib/constants/cache.ts`** — `CACHE_TTL` — FILE, FOLDER and QUERY, all ten hours; the default
  staleness window for `useFile` / `useFolder` / `useQueryResult`. Note the import specifier is
  `@/lib/constants/cache`, distinct from the client-env module `@/lib/constants`.

## Test and benchmark support

`frontend/lib/test/faux-llm-channel.server.ts` lets an out-of-process Playwright test drive the
real in-process orchestrator's LLM. It installs a content-keyed matcher on the faux providers of the
chat-reachable agents (web-analyst, analyst, benchmark-analyst, onboarding) and records every
request they receive.

```
Playwright ──HTTP──> app/api/test/faux[/received|/reset]   (404 unless E2E_MODE)
                        └─> configureFauxFromDTO → dtoToFauxMatch → agent fauxRegistration.setResponses
```

Because the browser driver cannot reach this module's memory, the wire format is the serializable
`FauxMatchDTO` (no functions). Two gotchas: `DEFAULT_TARGETS` must be extended when a new agent
becomes reachable from chat, or its calls run unfauxed; and `delayMs` is matched by **substring**,
not exact key, because the LLM context wraps the user text (a leading `<CurrentTime>` block) — an
exact lookup would silently never apply the delay.

`frontend/lib/benchmark/import-conversation.ts` is a thin client for `POST /api/benchmark/import`:
it ships a benchmark run's orchestrator log (plus the dataset's connections list) and gets back a
conversation id, which `app/benchmark/page.tsx` opens at `/explore/<id>` to continue the run in the
chat UI. The `connections` array is load-bearing — it is persisted on the conversation's
`meta.benchmark_connections`, and without it continued SQL fails with "connector 'X' not loaded".

`frontend/lib/instrumentation/register-modules.ts` is the module-registry bootstrap:
`registerWithModules()` picks the PGLite or adapter-backed DB module from `getDbType()`, registers
auth / db / object-store / cache / namespace, runs `db.init()`, then `runBootTasks()` — the
unhandled-rejection router and the chat-runtime warm, which live here rather than in
`instrumentation.ts` so that registering modules is enough to get them. It is called by
`frontend/instrumentation.ts` at server start and by the standalone scripts
(`scripts/heal-stories.ts`, `scripts/migrate-conversations-to-v3.ts`) so they get the same wiring as
the app.

## `lib/og` — share cards

`frontend/lib/og/capture-story-preview.ts` runs in the browser when a story is made public: it finds
`[data-story-capture="<id>"]`, serializes the live surface (falling back to the generic element
serializer), crops the **top band** to the 1200×630 OG aspect, and POSTs a JPEG data URL to
`/api/files/[id]/preview`. `og-image.tsx` (server) pre-blurs that screenshot with sharp — satori
cannot do CSS blur — and composes the final card via `og-cards.tsx` (`next/og` + JetBrains Mono from
`public/fonts`, org branding from `getConfigsForMode`). The composed PNG is stored in the object
store and streamed back verbatim by `app/l/[shareId]/og/route.ts` — **a story card is never rendered
at crawl time**. Only the *generic* fallback (no capture yet, revoked share, root) can render on
demand, and even that serves the committed `public/ogs/generic.png` unless the org has a custom
expanded logo. That route is a plain handler rather than Next's `opengraph-image` convention because
the convention only ever emits the dev localhost host. `og-helpers.ts`'s `ogCacheKey` embeds
`updated_at` (normalized — `pg` returns `Date`, PGLite returns ISO strings) so the cache self-busts
on every edit.

## Key files

| Task | File |
|---|---|
| Add a file type, change its icon/color/height/markers | `frontend/lib/ui/file-metadata.ts` |
| Wire a file type to its viewer | `frontend/lib/ui/fileComponents.tsx` |
| Add a server env var / secret | `frontend/lib/config.ts` (name must not collide with `constants.ts`) |
| Add a client-safe or build-stamped constant | `frontend/lib/constants.ts` |
| Understand why a config name collision fails `tsc` | `frontend/lib/__checks__/config-constants-no-overlap.ts` |
| Add a connector or LLM provider to the published contract | `frontend/compatibility.json` + `frontend/lib/ui/connection-type-options.ts`, guarded by `frontend/lib/compatibility/__tests__/compatibility.test.ts` |
| Add an `OrgConfig` field | `frontend/lib/branding/whitelabel.ts` — interface **and** `mergeConfig` |
| Change Chakra tokens / recipes | `frontend/lib/ui/theme.ts` |
| Bound concurrency of async work | `frontend/lib/utils/semaphore.ts` |
| Change the query-result cache key | `frontend/lib/utils/query-hash.ts` (client and server must agree) |
| Change error-boundary auto-recovery | `frontend/lib/utils/error-recovery.ts` |
| Add an embeddable chrome level | `frontend/lib/view/view-types.ts` |
| Change dashboard parameter precedence | `frontend/lib/dashboard/effective-params.ts` |
| Drive the LLM from a Playwright test | `frontend/lib/test/faux-llm-channel.server.ts` |
| Change server bootstrap wiring | `frontend/lib/instrumentation/register-modules.ts` |
| Change the public share card | `frontend/lib/og/og-image.tsx` · `og-cards.tsx` · `capture-story-preview.ts` |
