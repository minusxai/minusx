# MinusX

MinusX is an open-source agentic business intelligence platform: a file-system-shaped BI tool
whose questions, dashboards, stories, reports and alerts are documents an AI agent can read and
write directly.

This file is the authoritative description of the project — architecture, every module, how modules
interact, and the development philosophy that governs how work is done here. It documents the code
**as it is today**. There is no plan narrative, no migration history, and no changelog; that is what
git is for.

**This file is a hub.** It carries the system shape, the module map, and the development philosophy
that governs every task — the things that apply no matter what you are editing. Twenty module docs
carry the detail.

A nested `CLAUDE.md` is loaded lazily, when files in its directory are read, so its cost is paid only
by work that needs it. This file keeps an orientation paragraph and a link for each, so nothing is
invisible to someone reading top-down. Keep this file small: everything here is loaded into **every**
session.

| Doc | Covers |
|---|---|
| `frontend/orchestrator/CLAUDE.md` | The `MXTool`/`MXAgent` contract and the registration rule |
| `frontend/agents/CLAUDE.md` | The agent hierarchy — and why `benchmark-analyst` is production, not benchmarks |
| `frontend/lib/chat/CLAUDE.md` | The turn pipeline, conversation storage, the registrables hub |
| `frontend/lib/sql/CLAUDE.md` | SQL ↔ IR. The subtlest correctness traps in the repo |
| `frontend/lib/connections/CLAUDE.md` | The nine connectors behind one interface |
| `frontend/lib/query-cache/CLAUDE.md` | The execution pipeline and the durable SWR/lease/blob cache |
| `frontend/lib/database/CLAUDE.md` | The document DB: schema-as-data, adapters, migrations, the version gate |
| `frontend/lib/semantic/CLAUDE.md` | Semantic models, contexts, views, Atlas content schemas |
| `frontend/lib/viz/CLAUDE.md` | Vega rendering, the V1→V2 bridge, the editing surface |
| `frontend/lib/story-ui/CLAUDE.md` | Story authoring: static JSX as inert data, registry, interpreter |
| `frontend/lib/story-surface/CLAUDE.md` | Mounting a self-contained document surface (+ shared render gotchas) |
| `frontend/lib/screenshot/CLAUDE.md` | Capture: serialization to image, client and headless |
| `frontend/lib/auth/CLAUDE.md` | Sessions, access rules, mode and namespace isolation, the rubric |
| `frontend/lib/tools/CLAUDE.md` | The browser-side tool bridge |
| `frontend/lib/jobs/CLAUDE.md` | Scheduled jobs, Slack/MCP, messaging, telemetry |
| `frontend/lib/CLAUDE.md` | The small shared `lib/` modules that need no doc of their own |
| `frontend/store/CLAUDE.md` | Redux, the listener middleware, browser file/query operations |
| `frontend/components/CLAUDE.md` | Container/View separation, the kit/Chakra split, chat UI |
| `frontend/app/CLAUDE.md` | Every API endpoint and page; the `handleApiError` contract |
| `frontend/test/CLAUDE.md` | npm scripts, Vitest layout, the test DB harness, Playwright, CI |

## Where a directory is documented

Module docs load lazily — when files in their own directory are read. Several docs cover sibling
directories, so this table is the routing map. If you are editing something and want its doc, find
the directory here.

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
| `lib/auth`, `lib/http`, `lib/mode`, `lib/namespace`, `lib/rubric` | `frontend/lib/auth/CLAUDE.md` |
| `lib/tools` | `frontend/lib/tools/CLAUDE.md` |
| `lib/jobs`, `lib/integrations`, `lib/messaging`, `lib/analytics` | `frontend/lib/jobs/CLAUDE.md` |
| `lib/file-state`, `lib/hooks`, `store/**` | `frontend/store/CLAUDE.md` |
| any other small `lib/*` module | `frontend/lib/CLAUDE.md` |
| `components/**` | `frontend/components/CLAUDE.md` |
| `app/**` | `frontend/app/CLAUDE.md` |
| `test/**`, `scripts/**`, `.github/**` | `frontend/test/CLAUDE.md` |

**Which modules get their own doc is measured, not guessed.** Depth is implementation size over the
number of exports anything outside actually imports; grouping is by shared consumers, not by topic.
`lib/og` sits with the small shared modules rather than under render surfaces because it has no
consumer in common with any of them — it was only ever grouped there because it also produces an image.

## Shape of the system

There is **one deployable application**: a Next.js app under `frontend/`. There is no separate
backend service. AI chat and agent orchestration run in-process inside it, and analytics queries
run in Node.js connectors inside it. A second, entirely separate app under `docs/` builds the
public documentation site.

```
                        ┌──────────────────────── frontend/ (Next.js) ────────────────────────┐
  browser ──HTTP/SSE──▶ │  app/            route handlers + pages                             │
                        │  components/     containers (Redux) → views (pure presentation)     │
                        │  store/          Redux + listener middleware (drives chat & tools)  │
                        │                                                                     │
                        │  orchestrator/   the engine: append-only log, step loop, tool tiers │
                        │  agents/         agent + tool definitions (analyst, slack, eval, …) │
                        │                                                                     │
                        │  lib/            the substance — see the module map below           │
                        └──────────┬───────────────────────────────┬──────────────────────────┘
                                   │                               │
                       document DB │                               │ analytics engines
                  (PGLite/Postgres)│                               │ (DuckDB, BigQuery, Postgres,
                   files, contexts,│                               │  SQLite, Athena, Mongo,
              conversations, users │                               │  ClickHouse, CSV, Sheets)
```

**Two data planes, deliberately separate.** The *document DB* stores the BI artefacts themselves —
files, contexts, conversations, users, connections — as JSON content addressed by integer id. The
*analytics engines* are the customer's own warehouses, reached through connectors, and MinusX never
stores their data except as cached query results.

## Module map

| Area | Lives in | Owns |
|---|---|---|
| Chat engine | `frontend/orchestrator`, `frontend/agents` | The orchestration loop and every agent/tool definition |
| Chat serving | `frontend/lib/chat`, `lib/llm`, `lib/projection` | Turning an HTTP request into a run, and streaming it back |
| Query data plane | `frontend/lib/connections`, `lib/query-cache`, `lib/sql` | Executing SQL: connectors, caching, and the SQL↔IR layer |
| Semantic layer | `frontend/lib/semantic`, `lib/context`, `lib/views`, `lib/validation` | Authored semantic models, schema whitelisting, content schemas |
| Storage | `frontend/lib/data`, `lib/database`, `lib/object-store` | The document DB, `FilesAPI`, migrations, blobs |
| Client state | `frontend/store`, `frontend/lib/file-state`, `lib/hooks` | Redux, the listener middleware, and all browser file/query operations |
| Visualization | `frontend/lib/viz`, `lib/chart`, `components/viz`, `components/plotx` | Vega rendering, the DOM table/pivot tier, chart config |
| Render surfaces | `frontend/lib/story-ui`, `lib/story-surface`, `lib/screenshot` | Authoring, mounting and capturing rendered documents |
| Auth & access | `frontend/lib/auth`, `lib/http`, `lib/mode`, `lib/namespace`, `lib/rubric` | Sessions, permissions, mode and namespace isolation, file-health scoring |
| Tools & integrations | `frontend/lib/tools`, `lib/jobs`, `lib/integrations`, `lib/analytics` | Browser-bridged tools, scheduled jobs, Slack/MCP, telemetry |
| Routes | `frontend/app` | Every API endpoint and page |
| Components | `frontend/components` | The UI |
| Infrastructure | `frontend/scripts`, `frontend/test`, `.github`, `docs` | Build, tests, CI, and the docs site |

Each area below is an orientation paragraph and a pointer. The detail lives in the module doc.

---

## Chat Engine — `frontend/orchestrator/` + `frontend/agents/`

The in-process agent runtime behind **all** chat: browser, Slack, scheduled reports, evals,
micro-tasks, remote sessions and the benchmark CLI. Two trees with a hard boundary:

- **`orchestrator/`** — the generic engine. The conversation log, the step loop, the tool tiers, the
  single LLM call site. Owns no app concepts.
- **`agents/`** — every concrete agent and tool, and the app-specific context shapes.

→ **`frontend/orchestrator/CLAUDE.md`** for the `MXTool`/`MXAgent` contract and the registration rule.
→ **`frontend/agents/CLAUDE.md`** for the agent hierarchy — including why `benchmark-analyst` is the
base of the production analyst chain despite its name.

## Chat serving

What happens between an HTTP request and a streamed answer: turn orchestration, the registrables hub,
agent-args resolution, conversation storage (dedicated tables + LISTEN/NOTIFY) and the streaming bus.

→ **`frontend/lib/chat/CLAUDE.md`** for the turn pipeline, what each module owns, and the gotchas.

## Query data plane — `lib/connections`, `lib/query-cache`, `lib/sql`

Everything between "there is a query string" and "rows exist". Strict layering: `lib/sql` is pure
text/AST work with no I/O, `lib/connections` owns driver contact, `lib/query-cache` wraps execution
in a durable SWR + lease + blob cache.

→ **`frontend/lib/sql/CLAUDE.md`** — SQL ↔ IR. The subtlest correctness traps in the repo.
→ **`frontend/lib/connections/CLAUDE.md`** — the nine connectors.
→ **`frontend/lib/query-cache/CLAUDE.md`** — the execution pipeline and the cache.

## Semantic models, contexts, views, and Atlas schemas

Authored semantic models, the context tree and its whitelisting, saved views, and the Atlas content
schemas that validate every file type.

→ **`frontend/lib/semantic/CLAUDE.md`**

## Storage & Data Layer

The DOCUMENT plane: the `files` table and its siblings, the schema declared as data, the
PGLite/Postgres adapters, migrations, the data-version gate, secrets and the object store. Distinct
from the analytics plane (`frontend/lib/connections/`), which never touches these tables.

→ **`frontend/lib/database/CLAUDE.md`** for the schema declaration, the migration and gate rules,
and the storage gotchas.

## Client State: Redux store, file-state, hooks, navigation

The browser's source of truth: the store, the listener middleware, and every browser-side file and
query operation.

→ **`frontend/store/CLAUDE.md`**

## Visualization

How a query result becomes a chart: two vocabularies (V1 `vizSettings`, the V2 `viz` envelope), the
recipe system, the Vega/Vega-Lite render pipeline, the editing surface and the validation gates.
**Vega is the only chart engine** — there is no second renderer to fall back to.

→ **`frontend/lib/viz/CLAUDE.md`** for the full pipeline, the V1→V2 bridge and the gotchas.

## Render surfaces

A stored document becoming pixels, in three stages with different consumers — which is why this is
three docs rather than one chapter:

→ **`frontend/lib/story-ui/CLAUDE.md`** — authoring: static JSX as inert data, registry, interpreter.
→ **`frontend/lib/story-surface/CLAUDE.md`** — mounting: the same-origin iframe surfaces, plus the
  gotchas shared across all three.
→ **`frontend/lib/screenshot/CLAUDE.md`** — capture: serialization to image, server-side and client.

`lib/og` (share cards) is documented with the small shared modules: it has no consumer in common
with any of the above and was only ever grouped here because it also produces an image.

## Auth, Access Control, Mode Isolation, HTTP Helpers, and the File-Health Rubric

Who the user is, what they may touch, and how one workspace's effects stay out of another's:
`lib/auth`, `lib/http`, `lib/mode`, `lib/namespace`, `lib/rubric`.

→ **`frontend/lib/auth/CLAUDE.md`**

## Tools, Jobs, Integrations & Telemetry

Scheduled and manual job runs, the Slack and MCP surfaces, message transports, analytics.

→ **`frontend/lib/jobs/CLAUDE.md`** — jobs, integrations, messaging, telemetry.
→ **`frontend/lib/tools/CLAUDE.md`** — the browser-side tool bridge.

## API & Page Routes (`frontend/app`)

Every API endpoint and page. This layer is deliberately thin: auth staging, the `handleApiError`
contract, route grouping. The work happens in `lib/`.

→ **`frontend/app/CLAUDE.md`**

## UI Components (`frontend/components`)

The Container/View separation, the kit/Chakra split, the chat UI and the rendered-document surfaces.

→ **`frontend/components/CLAUDE.md`**

## Small shared lib modules

The file-type registry, config-vs-constants, the published compatibility contract, branding /
white-label, share cards (`lib/og`), the utils that carry a contract, and test/benchmark support.

→ **`frontend/lib/CLAUDE.md`**

## Build, Test & Docs Infrastructure

npm scripts, the Vitest project layout, the test database harness, the two Playwright suites and
their deliberately opposite gates, CI, and the published docs site.

→ **`frontend/test/CLAUDE.md`**

## Development philosophy

This section is not advisory. It describes how work is done in this repository, and it takes
precedence over habit, over convenience, and over what a task "seems to need".

### Test-driven development — the required order

**Every feature and every refactor follows this exact order. Do not implement first and back-fill
tests.**

1. **Contracts first.** Define types, interfaces, and method signatures. Reuse existing types; no
   duplication. Get the shape right before any behaviour exists.
2. **Tests second.** Write tests that exercise the ACTUAL behaviour, not helpers around it, and
   **confirm they FAIL (red) before implementing.**
3. **Implementation third.** Write code until the tests pass (green).
4. **Run the full suite** to confirm no regressions.
5. **Commit and push to the PR.**
6. **Browser-verify on the running dev server.** Drive the real flow. For chat, open the side-chat
   debug message and expand the model to read the EXACT request and response sent to the LLM.
   Don't assume; check.

> A green test that was never red is not a test — it is decoration. When asked "did you do TDD /
> browser-test?", answer honestly.

### Refactoring — Blue → Red → Blue

1. Identify the tests covering the existing behaviour. They must pass (**blue**).
2. Deliberately break the old implementation and confirm those tests fail (**red**). This is what
   proves the tests actually guard the behaviour rather than passing incidentally.
3. Re-implement until all tests pass (**blue**). Run the full suite, push, browser-verify.

The same proof applies to characterization tests written for existing code: if a test has never
been observed failing, you do not yet know that it tests anything.

### Keeping documentation consistent with code — enforced, not remembered

Documentation drifts silently, and stale documentation is worse than none: it sends the next
reader (human or agent) to a file that isn't there or a behaviour that no longer exists.

**Any change to the codebase must leave these three consistent, in the same change:**

1. **Code comments in every file touched** — a comment that describes the old behaviour is now a
   lie. Fix it or delete it.
2. **The relevant project documentation** (this file, and any per-directory agent guidance) — if
   the change alters architecture, moves or deletes a file the docs point at, or invalidates a
   documented gotcha.
3. **The relevant published docs pages** under `docs/content/**` — if the change alters
   user-visible behaviour, configuration, or setup.

This is part of the change, not follow-up work. A PR that changes behaviour and leaves the
documentation describing the old behaviour is incomplete.

**This is enforced by a hook, not by memory.** A `PostToolUse` hook on `Edit`/`Write` (configured
in `.claude/settings.json`) fires after code edits and requires the consistency check before the
change is considered done. Mechanical checks belong in the hook wherever they can be expressed —
for example, asserting that every file path referenced in documentation still resolves, which
catches the most common and most damaging form of drift in milliseconds and with no judgement.
What a mechanical check cannot catch is prose that is merely *wrong*; that remains the author's
responsibility, and the hook exists to make sure the question is asked every time.

### Validation

```bash
cd frontend
npm run validate    # type check + lint — ALWAYS use this to verify code correctness
```

**Never use `npm run build` for validation.** It is slow and memory-intensive. Run it only before
deployment.

### Commands

```bash
cd frontend
npm run dev                # dev server, http://localhost:3000
npm run validate           # type check + lint
npm run build              # production build — deployment only
npm run lint               # ESLint
npm test                   # all Vitest projects (node + ui + orchestrator)
npm test -- <pattern>      # specific test files
npm run test:main          # only the `node` project (integration/server tests)
npm run test:ui            # only the `ui` project (jsdom *.ui.test.tsx)
npm run test:orchestrator  # only the `orchestrator` project
npm run test:e2e           # Playwright full-app e2e
npm run test:qa            # QA flows (builds a local prod server)
npm run update-workspace-template   # re-run migrations on the seed template after adding one
```

Tests run on **Vitest** (`npm test` → `vitest run`), configured in `frontend/vitest.config.ts`
with three projects: `node`, `ui`, `orchestrator`. Run one with
`npx vitest run --project=<name> <pattern>`. There is no Jest — no `jest.config.*`, no `npx jest`.

### Test taxonomy — pick by what you are testing, not by habit

- **`node` (Vitest, node env)** — integration/server tests with **no DOM**. Drive Redux by
  dispatch, hit real API route handlers in-process (`mock-fetch`), faux LLM. The fastest
  full-stack layer.
- **`ui` (Vitest, jsdom, `*.ui.test.tsx`)** — component and hook **unit** tests. Mount one
  component or `renderHook` with specific props and assert DOM/behaviour. These are unit tests,
  not e2e; keep them here. Do not migrate them to Playwright: hook-identity and render-count
  tests have no browser-observable equivalent, and component isolation would be far slower and
  flakier as a full-app flow.
- **`orchestrator` (Vitest, node env)** — the headless orchestrator/agents tree.
- **Playwright (`test/e2e/*.spec.ts`, `npm run test:e2e`)** — **full-app e2e**: a real browser
  drives the booted app under `E2E_MODE` (faux LLM via `/api/test/faux`, store exposed on
  `window.__MX_STORE__`, SVG charts). Use ONLY for genuine cross-page user flows.

If real *rendering* fidelity is ever needed for a component test (real SVG or canvas, which jsdom
stubs), the right tool is **Vitest browser mode** — component-in-real-browser as a separate
opt-in project — NOT full-app Playwright e2e.

### QA flows

A separate Playwright project (`playwright.qa.config.ts`, `test/qa/*.spec.ts`, `npm run test:qa`)
driving the **real app with real data and no faux LLM**, portable across a local prod build and a
live deployment. It asserts deterministic outcomes — query results, saved files.

**How it runs.** With no `QA_BASE_URL` it builds and starts a production server (build-time e2e
flag off, runtime e2e gate on) — **always a prod build, never `next dev`**, because the dev server
compiles routes on demand and races cold builds under parallel workers. Against a deployment, set
`QA_BASE_URL` (plus `QA_EMAIL` / `QA_PASSWORD` / `QA_E2E_SECRET`) and the webServer is skipped.

**Non-negotiable rules:**
- **Tutorial mode only — never org/production.** Every navigation and `/api/files` discovery
  carries `mode=tutorial`; mutating flows additionally `assertTutorialMode(page)` before writing
  and hard-assert created paths start with `/tutorial`. The system default is `org`, so tutorial
  is opt-in on *every* request — **a missing `mode=tutorial` silently writes to production.**
- **Real clicks and typing, not API or URL shortcuts.** Open files by clicking their tile, create
  via the Create menu, type SQL into the editor, click Save.
- **Locate elements by `aria-label` only** (`getByLabel`). If a control lacks one, add it to the
  component — do not work around it.
- **The setup chain is serial:** login → reset tutorial → wait for data → flows. Flows themselves
  run with `workers > 1` (read-only plus reset-once-up-front makes them race-free).

### Writing tests

**Chat and agent e2e tests run fully in-process** — there is no separate backend or LLM mock server.
The LLM is driven by each agent's **faux provider**: import `fauxRegistration` from the agent
module and call `setResponses([...])`. These tests exercise the full stack: Redux → listener
middleware → API route → in-process orchestrator → faux LLM, and should observe automatic
behaviours rather than manually simulating them.

**UI test element queries: `aria-label` ONLY.** Never `getByRole`, `getByText`,
`getByPlaceholderText`, `getByTestId`, or any other strategy. Every interactive element is located
via `getByLabelText` / `findByLabelText`. If an element lacks an `aria-label`, add one to the
component — do not work around it with a different query.

**`TalkToUser` is not a normal tool call for most agents — do not mock it as one.** It exists only
in the Slack agent's toolset. Every other agent replies via `stopReason: 'stop'` with plain
content. The correct faux pattern for a non-Slack agent reply is
`fauxAssistantMessage('reply text', { stopReason: 'stop' })`. Mocking `TalkToUser` as a tool call
for a non-Slack agent fails to resolve and produces the "I do not have a text reply" fallback.

### Design principles

**Deep modules (Ousterhout) — the guiding design principle of this repository.** Modules should
have simple, narrow interfaces hiding substantial implementation.

- A feature's complexity belongs in ONE cohesive module; callers compose a few deep hooks or
  functions rather than orchestrating internals.
- Components should be thin compositions. If a component grows past roughly 150 lines of logic,
  extract the subsystems into hooks or pure modules under the owning `lib/` module — pure logic in
  plain `.ts` files so it is unit-testable without a DOM.
- Prefer making an existing module **deeper** (adding capability behind the same interface) over
  adding a new shallow module or a pass-through layer. Classitis, tiny wrappers, and
  config-forwarding layers are code smells.

### Code smells to avoid

- **Inline/dynamic imports.** Always import at the top of the file. `const { foo } = await
  import('./bar')` signals a circular dependency or poor module design — fix the architecture by
  extracting shared code. Never use an inline import to "fix" a circular dependency. Enforced by
  ESLint.
- **Direct Redux state mutation.** Always use slice actions.
- **Inline API calls or data fetching in components.** Use the CORE hooks or listener middleware;
  do not reach for cascading `useEffect` chains.
- **Explicit key enumeration.** Never manually re-list every field of a typed object when you can
  pass or spread it — this causes change amplification, where adding a field to the interface means
  hunting down every place keys were listed, and you *will* miss some. The typed interface is the
  single source of truth. Extract specific keys only when the target API requires a different shape.

### Component patterns

- **Container/View separation is enforced.** Containers connect to Redux and pass data and
  callbacks down; views are pure presentation. An ESLint rule blocks `@/store/hooks` and
  `react-redux` imports in the migrated view files by name, so a regression fails `npm run validate`
  rather than review. **When touching a view: if you need new state, add it as a prop and source it
  in the container — not via a direct Redux hook.**
- **Composition over inheritance.** Build complex UIs from simple, reusable components.
- **Single responsibility.** Each component does one thing well.

### UI design — avoid "AI slop"

**Never use a coloured accent bar on the left edge of a card or panel** (for example
`borderLeft="3px solid <accent>"` to signal state). It reads as generic AI-generated design. Convey
state with existing affordances instead: badges, toggles, text colour, a subtle background tint.

### Pull requests

**Raise every PR with NO description body** — no summary, no what/why, no test plan, no descriptive
comment. Open it with an empty body (`gh pr create --body ""`). The title alone stands.

### API routes

**Always use `handleApiError` in catch blocks.** Never return `NextResponse.json({ error }, {
status: 500 })` directly.

```typescript
import { handleApiError } from '@/lib/http/api-responses';

export async function POST(req: NextRequest) {
  try {
    // ...
  } catch (error) {
    return handleApiError(error); // reports the bug and returns a consistent error shape
  }
}
```

ESLint enforces this: a direct `NextResponse.json` with `{ status: 500 }` is a lint error under
`app/api/**`. If a route genuinely needs a custom 500 shape, suppress inline with
`// eslint-disable-next-line no-restricted-syntax` and report the error manually via
`appEventRegistry.publish(AppEvents.ERROR, ...)`.

### Environment variables

- **Server-only values** (secrets, DB URLs, internal flags): import from `frontend/lib/config.ts`,
  which carries an `import 'server-only'` guard and fails the build if a client component imports it.
- **Client-safe values** (`NEXT_PUBLIC_*`, `NODE_ENV`): import from `frontend/lib/constants.ts`.
- **Never access `process.env` directly** outside those two files. Enforced by ESLint.

**Runtime-config → Redux pattern:** server config is read in `lib/config.ts`, passed as Redux
`preloadedState` at SSR, and consumed via a selector. `Semaphore` takes a *getter* for its limit so
Redux changes apply without recreating it.

### Scripts

**Scripts belong in `frontend/scripts/` as Node.js run through `tsx`.** The frontend already has
the needed dependencies; use `import { config } from 'dotenv'; config()` to load `frontend/.env`,
and add an entry to `frontend/package.json`.

### Adding agent tools and agents

1. Add the tool (an `MXTool` subclass with a TypeBox param schema) or agent under `frontend/agents/**`.
2. Register it in the orchestration core's `REGISTRABLES`; headless runners use `HEADLESS_REGISTRABLES`.
3. Implement the behaviour: server tools directly in the subclass's `execute()`; frontend-bridged
   tools register a handler in the tool-handler registry.
4. Keep the TypeBox param schema and the handler behaviour in sync — the schema is the single source
   of truth for the arguments the LLM is told it may pass.
5. A **root** agent needs a second registration: `ROOT_AGENT_BY_NAME` in the same file. `REGISTRABLES`
   only makes a class instantiable on resume; without the map entry no request can select it.
6. Adding a `{slot}` to a shared prompt is a breaking change to every other renderer of that id.
   `pyFormat` throws `Missing variable '<name>'` — it does not render the literal — so a turn dies at
   prompt assembly, not at review. Grep every `renderPrompt('<id>', …)` call site and give each the new
   slot (usually `''`).

**Tool registration is not optional.** When a tool spawns another tool, or an agent dispatches a
sub-agent, the spawned class MUST be in `REGISTRABLES` — the orchestrator instantiates it from that
registry by `schema.name` when resuming or reconstructing a saved conversation log.

**Prefer one registered class over one class per configuration.** When behaviour varies by
user-authored data rather than by code — custom agents are the case in hand — put the resolved
definition on the per-turn context and register a single class. A class per definition makes every
saved log unresumable as soon as the underlying definition is renamed or deleted.

### Database schema changes

Declare the change in `frontend/lib/database/schema/tables.ts` (PGLite and Postgres share it),
update the shared types, then re-record `frontend/lib/database/__tests__/__snapshots__/schema-shape.test.ts.snap`.
Run `npm run update-workspace-template` if the seed template is affected.

**Additive DDL needs no migration entry.** `frontend/lib/database/schema/render.ts` emits every
declared column as `ALTER TABLE … ADD COLUMN IF NOT EXISTS` alongside the `CREATE TABLE`, so a
database built from an older declaration gains new columns, tables and indexes on the next boot by
itself. A `MigrationEntry` and a `LATEST_DATA_VERSION` bump are for changes to the shape of existing
**row content** — bumping the version for a bare column add strands every unmigrated workspace
behind the data-version gate for no reason.

Two fields fail open, so declare them deliberately: a `Table` without `scope` reads as shared across
the whole deployment, and a `Unique` without `scope` reads as a global invariant.
`frontend/lib/database/schema/__tests__/equivalence.test.ts` asserts both are present precisely
because forgetting either is silent. Never smuggle raw SQL through the declaration — see
`frontend/lib/database/schema/types.ts` for why there is no such field.

### Debugging async orchestration

Debug multi-tier async execution by adding temporary logging at tier boundaries — orchestrator
stream events, tool execution results — to trace data flow through the execution loop.

### Trace a new field or tool end to end

Three defect classes from shipping the semantic tier were each invisible to a green test suite, and they share one shape: a value exists at one layer and is silently absent at the next.

- **Registration is not advertisement.** A tool present in `REGISTRABLES` but missing from an agent's `tools` array is never offered to the model — the array replaces rather than extends, and nothing errors.
- **Schema is not surface.** A field absent from the agent-facing projection (`ContextAgentContent`) is dropped by the markup round-trip in *both* directions, so agent edits vanish without a message.
- **A fold that enumerates fields drops the new one.** A writer that lists keys instead of spreading them bypasses whatever gate reads the rest.

None of these throws, so no test fails. The check is to follow the value through registry → advertisement → schema → markup → persistence in a running app, and to verify by **reading the artifact** — the stored JSON, the debug view of the exact request sent to the model — never by eyeballing output that merely looks plausible.

