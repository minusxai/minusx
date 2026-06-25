# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Keeping docs current:** `docs/DOCS_SYNC.md` records the commit these docs (CLAUDE.md, README, `docs/`) were last reconciled to. To find drift, run `git log --oneline <hash>..HEAD`; after updating docs, bump the hash there.

---

## ⚠️ PRIMARY WORKING STYLE: TEST-DRIVEN DEVELOPMENT

**This is non-negotiable. Every feature and refactor MUST follow one of these two flows.**

### New features — Red → Green
1. Write the failing test first (red). Confirm it fails before implementing.
2. Implement until the test passes (green).
3. Run the full suite to confirm no regressions.

### Refactoring — Blue → Red → Blue
1. Identify tests covering existing behaviour — they must pass (blue).
2. Break the old implementation and confirm tests fail (red). This proves the tests guard the behaviour.
3. Re-implement until all tests pass (blue). Run the full suite.

> A green test that was never red is not a test — it's decoration.

---

## V2 chat: `frontend/orchestrator/` and `frontend/agents/`

These directories hold the in-process TypeScript orchestrator and agent/tool definitions that power **all chat**. They are wired into production via `lib/chat-orchestration-v2.server.ts`, which the chat API routes (`app/api/chat/route.ts`, `app/api/chat/stream/route.ts`) invoke for every request. **This is the only chat engine.** (`lib/chat-orchestration.ts` survives only as a shared request/response *types* module, despite its name.)

**What's where:**
- `frontend/orchestrator/` — the `Orchestrator` engine plus conversation-log types (`@/orchestrator/types`) and LLM types (`@/orchestrator/llm`).
- `frontend/agents/` — agent + tool definitions (`analyst/`, `benchmark-analyst/`, `web-analyst/`, ...). Server-only tools live in `*.server.ts` variants; the `Base*` classes (no `server-only` import) are reused by the benchmark CLI.
- Both trees have their own tests under `__tests__/` (the `orchestrator` Vitest project), plus integration coverage through the chat API routes.

**While the migration is in progress:** when changing shared code in `frontend/lib/`, keep both the v1 and v2 chat paths working.

---

## Project Overview

MinusX is an agentic, file-system based BI Tool that combines:
- **Frontend**: Next.js 16 + React 19 + Chakra UI v3 + Redux (also hosts the in-process AI chat/agent orchestrator — no separate backend service)
- **Storage**: PGLite (open-source) or Postgres for documents (questions, dashboards), DuckDB/BigQuery/PostgreSQL for analytics
- **Architecture**: Dual-database system with integer ID-based file access, hierarchical permissions, and mode-based file system isolation

## Common Development Commands

### Frontend (Next.js)
```bash
cd frontend
npm run dev                # Start dev server (http://localhost:3000)
npm run validate           # Type check + lint (use this to validate code)
npm run build              # Production build (slow, use only before deployment)
npm run lint               # Run ESLint
npm test                   # Run all Vitest tests (node + ui + orchestrator projects)
npm test -- <pattern>      # Run specific test files
npm run test:main          # Run only the `node` project (integration/server tests)
npm run test:ui            # Run only the `ui` project (jsdom *.ui.test.tsx tests)
npm run test:orchestrator  # Run only the `orchestrator` project
npm run update-workspace-template  # Re-run migrations on the seed template after adding a migration
```

**IMPORTANT: Always use `npm run validate` to quickly verify code correctness. Do NOT use `npm run build` for validation - it's too slow and memory-intensive. Only run `npm run build` before deployment.**

**IMPORTANT: Frontend tests run on Vitest (`npm test` → `vitest run`), configured via `frontend/vitest.config.ts` with three projects: `node` (integration/server tests, node env), `ui` (`*.ui.test.tsx` component tests, jsdom env), and `orchestrator` (the headless orchestrator/agents tree). Run a single project with `npm run test:main` / `test:ui` / `test:orchestrator`, or `npx vitest run --project=<name> <pattern>`. (The repo previously used Jest; that has been fully migrated to Vitest — there is no `jest.config.*` or `npx jest`.)**

### Test taxonomy — which layer for what (Tests/QA/Evals Arch V2)

Four distinct layers; pick by what you're testing, not by habit:
- **`node` (Vitest, node env)** — integration/server tests with **no DOM**. Drive Redux by dispatch, hit real API route handlers in-process (`mock-fetch`), faux LLM. Fastest full-stack layer.
- **`ui` (Vitest, jsdom)** — **component & hook UNIT tests** (`*.ui.test.tsx`). Mount one component / `renderHook` with specific props, assert DOM/behavior. These are **unit tests, not e2e** — keep them here. jsdom is the right tool (fast, direct props, many cases). Do **not** move these to Playwright: hook-identity/render-count tests have no browser-observable equivalent, and component-isolation tests would be far slower/flakier as full-app flows. (`agent-e2e.ui.test.tsx` / `onboarding-wizard-e2e.ui.test.tsx` are misnamed — they're jsdom component tests, candidates to migrate to Playwright since they're flow-shaped.)
- **`orchestrator` (Vitest, node env)** — the headless orchestrator/agents tree.
- **Playwright (`test/e2e/*.spec.ts`, `npm run test:e2e`)** — **full-app E2E**: real browser drives the booted app under `E2E_MODE` (faux LLM via `/api/test/faux`, store on `window.__MX_STORE__`, SVG charts). Use ONLY for genuine cross-page user flows. See `frontend/test/e2e/README.md`.

> If real *rendering* fidelity is ever needed for a component test (e.g. real SVG/canvas, which jsdom stubs), the right tool is **Vitest browser mode** (component-in-real-browser), NOT full-app Playwright e2e — a separate opt-in project, not a default.

### QA flows (`test/qa/*.spec.ts`, `npm run test:qa`)

A separate Playwright project (`playwright.qa.config.ts`) that drives the **real app, real LLM-free flows, real data** — for portability across a local prod build *and* live deployments. Distinct from `test/e2e` (faux LLM, `E2E_MODE`): QA flows assert deterministic outcomes (query results, saved files) with **no faux channel**.

**How it runs:**
- **Locally / in CI (no `QA_BASE_URL`):** the config **builds + starts a prod server** (`npm run build && npm run start`, `output: standalone`-style), with the build-time E2E flag OFF and the runtime e2e gate ON. The CI job is `.github/workflows/qa.yml` (`QA Flows (prod build)`) — it runs in PR CI, so QA flows gate merges. **Always prod build, never `next dev`** — the dev server compiles routes on demand and races cold builds under parallel workers (`page.goto` timeouts).
- **Against a deployment:** set `QA_BASE_URL` (+ `QA_EMAIL`/`QA_PASSWORD`/`QA_E2E_SECRET`); the webServer is skipped and flows hit that URL. (The `deploys` repo's `qa.yml` action does this.)

**Non-negotiable rules for QA flows:**
- **Tutorial mode only — never org/production.** Every navigation and `/api/files` discovery carries `mode=tutorial` (helpers `e2eUrl`/`modeUrl`/`QA_MODE` in `test/qa/flows.ts`). Mutating flows additionally `assertTutorialMode(page)` before writing and hard-assert created paths start with `/tutorial`. The system default is `org`, so tutorial is opt-in on *every* request — a missing `mode=tutorial` silently writes to production.
- **Real clicks/types, not API/URL shortcuts.** Open files by clicking their tile (`openFileByClick`), create via the Create menu, type SQL into the editor, click Save. Locate elements by **`aria-label` only** (`getByLabel`) — if a control lacks one, add it to the component (don't work around it).
- **Setup chain is serial: login → reset tutorial → wait for data → flows.** `auth.setup` (registers + logs in locally), `reset.setup` (resets tutorial to pristine seed, then `waitForTutorialData`). Flows themselves run with `workers > 1` (read-only + reset-once-up-front = race-free).

**Tutorial sample data:** registration seeds mxfood data fire-and-forget (`lib/modules/auth/index.ts` → `copySeedMxfoodForMode`), so it's briefly unavailable. Readiness is exposed via `GET /api/orgs/seed-status` (`getMxfoodSeedStatus` + `ObjectStore.exists`); the `DataPrepBanner` shows a progress indicator until ready, and QA setup polls it (`waitForTutorialData`) before data-asserting flows.

**Adding a QA flow:** add a `*.spec.ts` under `test/qa/`, compose helpers from `flows.ts` (or add new ones there), stay in tutorial mode, drive via clicks/`getByLabel`, assert against the exposed Redux store (`window.__MX_STORE__`, via `assertRedux`). Verify with `npm run test:qa <pattern>` (builds a local prod server).

### Backend

There is no separate backend service. The AI chat/agent orchestration runs
in-process inside the Next.js app (TypeScript orchestrator under
`frontend/orchestrator/` + `frontend/agents/`). Analytics queries run
in the Node.js connectors (`frontend/lib/connections/`).

Chat is served by the Next.js routes `POST /api/chat` and `POST /api/chat/stream`, which run the in-process orchestrator. Tool/skill schemas are served from TypeScript (`GET /api/tools/schema`).

**Query execution** runs on the Next.js side: `app/api/query/route.ts` → `lib/connections/run-query.ts` → Node.js connectors in `lib/connections/` (DuckDB, BigQuery, PostgreSQL, SQLite, Athena, Mongo, CSV, Google Sheets).

### Database Management

The document DB is seeded **automatically at workspace/company registration** (`lib/modules/auth/index.ts`): it reads `lib/database/workspace-template.json`, substitutes template vars, runs `applyMigrations`, and atomically imports the result via `atomicImport`. There is no manual import/export step.

**To change seed data:** edit `lib/database/workspace-template.json` directly.

**After adding a migration**, refresh the template:
```bash
cd frontend
npm run update-workspace-template   # re-runs migrations on the template; review with `git diff`
```

### Database Migrations

**Documents DB (PGLite/Postgres)** — uses a versioned migration framework:
1. Increment `LATEST_DATA_VERSION` in `lib/database/constants.ts`
2. Add a `MigrationEntry` to `MIGRATIONS` array in `lib/database/migrations.ts`
3. Run `npm run update-workspace-template` to bump the seed template; migrations then apply automatically at workspace registration

**Analytics DuckDB** (`frontend/lib/analytics/file-analytics.db.ts`) — has no migration framework. `initSchema()` runs `CREATE TABLE/INDEX IF NOT EXISTS` once per process restart, which is a no-op on existing databases. To add new columns to an existing table, append `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` guards to `SCHEMA_SQL` after the relevant `CREATE TABLE` block. These guards are idempotent (no-op on fresh installs) and fire automatically on each server restart.

**App Event Registry** (`frontend/lib/app-event-registry/`) — a lightweight server-side pub/sub system for app-level events (file operations, LLM calls, query executions, etc.). API routes publish typed events via `appEventRegistry.publish(AppEvents.X, payload)`; analytics handlers subscribe centrally in `index.ts` rather than being scattered across call sites. Always use this pattern when adding new analytics tracking — never call analytics functions directly from API routes or business logic.

## High-Level Architecture

### Dual-Database System

**Frontend (Next.js)** owns two data planes:
- **Document DB** — PGLite (open-source) or Postgres (`DATABASE_URL`): questions, dashboards, notebooks, connections, contexts, users, folders. Accessed directly by Next.js server components.
- **Node.js query connectors** (`lib/connections/`) — execute analytics queries directly against DuckDB / BigQuery / PostgreSQL / SQLite / Athena / Mongo / CSV / Sheets.

**AI chat/agent orchestration** runs in-process in the Next.js app (TypeScript orchestrator under `frontend/orchestrator/` + `frontend/agents/`): LLM calls, append-only conversation log, tool/skill schemas. There is no separate backend service.

### Key Concepts

**Document Storage (PGLite/Postgres)**
- Open-source: PGLite (embedded Postgres-compatible, directory-based persistence); hosted: Postgres via `DATABASE_URL`; adapters in `lib/database/`
- Files accessed by integer ID via `/f/{id}` routes (not by path)
- Path field is display-only for organization (e.g., `/org/Revenue-Summary`)
- Content stored as JSON in `content` column
- Schema: `files` table with `id`, `name`, `path`, `type`, `content`, timestamps

**File Types**
- `question` - SQL query with visualization (table, line, bar, area, scatter)
- `dashboard` - Collection of questions with grid layout
- `notebook` - Vertical list of cells; each cell is either a full inline SQL question (query + viz + connection + params + @refs) or a rich-text (markdown) cell. Content schema `NotebookContent` (`cells: NotebookCell[]`) in `lib/validation/atlas-schemas.ts`; rendered by `NotebookContainerV2` → `NotebookView` → `NotebookSqlCell`/`NotebookTextCell`
- `presentation` - Slide-based presentations (future)
- `report` - Report-style documents (future)
- `connection` - Database connection configuration
- `context` - Schema whitelist + team documentation
- `users` - User management
- `folder` - Organizational containers
- `conversation` - AI chat conversation logs
- `config` - Company configuration (branding, settings)

**Company Configs System**
The configs system provides per-company configuration stored as database documents:

- **Storage**: Document at `/configs/config.json`
- **File Type**: `'config'`
- **Content Structure**:
  ```json
  {
    "branding": {
      "logoLight": "/custom_logo.svg",
      "logoDark": "/custom_logo_dark.svg",
      "displayName": "Custom Company",
      "agentName": "Custom Agent",
      "favicon": "/custom_favicon.ico"
    }
  }
  ```

**Loading Strategy** (Optimized for SSR):
- **Configs + Contexts**: Always load on server-side render (SSR)
- **Connections**: 50ms timeout on SSR, client-side fallback if exceeded
- **Server hydration**: All three resources (configs, contexts, connections) passed to Redux as `preloadedState`
- **Client fallback**: API routes (`/api/configs`, `/api/contexts`, `/api/connections`) available if data not SSR'd

**Merge Behavior**:
- Database values override hardcoded defaults from `frontend/lib/branding/whitelabel.ts`
- If config document doesn't exist, falls back to hardcoded `COMPANY_BRANDING` object
- Partial configs supported: only specified fields override, others use defaults

**Client Usage**: `useConfigs()` hook returns `{ branding }` from Redux. Fall back to `getCompanyBranding(companyName)` from `lib/branding/whitelabel.ts` if not loaded.

**File References**
- Files can reference other files (e.g., dashboards reference questions)
- FileReference interface: `{ type: 'question', id: number }`
- Only one level of reference resolution (no recursive references)
- Dashboards store array of question IDs in their content
- When loading a dashboard, referenced questions are fetched and included
- References prevent circular dependencies at save time

**Query Execution Flow**
1. User edits SQL → Redux tracks state
2. Execute → `POST /api/query`; client calls are funneled through `querySemaphore` (caps concurrency at `MAX_CONCURRENT_QUERIES`)
3. Route applies params (`applyNoneParams`) and derives dialect via the lightweight `ConnectionsAPI.getRawByName` — *not* `FilesAPI.loadFile`, which can trigger schema profiling
4. Server `queryCache` (TTL `QUERY_CACHE_TTL_MS`, default 60s) serves hits; concurrent identical queries share one run via `queryInflight`
5. On a miss, `runQuery` (`lib/connections/run-query.ts`) picks the connector via `getNodeConnector`, executes → QueryResult → viz updates

`getQueryResult({ forceLoad: true })` / `useQueryResult().refetch()` bypass the cache (powers the retry button).

**Schema Profiling & Statistics Enrichment**

Connection schemas are enriched with column-level metadata (category, null counts, top values, min/max) via `lib/connections/statistics-engine.ts` → `profileDatabase(connectorType, schema, queryFn)`, which dispatches per connector (PostgreSQL via `pg_stats`/`pg_class`; DuckDB/CSV/Sheets via `SUMMARIZE`; BigQuery via `INFORMATION_SCHEMA`, descriptions only; SQLite via generic SQL; unknown → pass-through). Profiling runs during schema refresh in `lib/data/loaders/connection-loader.ts` and is cached in the connection document. The `ColumnMeta` interface lives in `lib/connections/base.ts`.

**State Management**
- Redux for page-level state (questions, dashboards)
- Dual-state pattern: `originalState` (from DB) vs `currentState` (edited)
- Dirty detection: Compare states via JSON serialization
- After save: Update `originalState` to match `currentState`

### Directory Structure

- `frontend/` — Next.js 16 app (React 19, Chakra UI, Redux): `app/` (App Router pages + API routes), `components/`, `lib/` (utilities, API clients, types), `store/` (Redux slices), `orchestrator/` + `agents/` (in-process AI chat/agent engine).
- `data/` — database files (PGLite documents, DuckDB analytics).

## Key Design Patterns

### Development Patterns & Best Practices

**Code Smells to Avoid** (project-specific; ESLint enforces several)
- **Inline/dynamic imports** — ALWAYS import at the top of the file. `const { foo } = await import('./bar')` signals a circular dependency or poor module design; fix the architecture (extract shared code) rather than working around it. Never use inline imports to "fix" circular deps. ESLint rule `no-restricted-syntax` enforces this.
- **Direct Redux state mutation** — always use slice actions.
- **Inline API calls / data fetching in components** — use the CORE hooks (`useFile`, `useFolder`, ...) or listener middleware; don't reach for cascading `useEffect` chains.
- **Explicit key enumeration** — never manually re-list every field of a typed object when you can pass or spread it. This causes change amplification: add a field to the interface and you must hunt down every place keys were listed, and you WILL miss some.
  - Bad: `register({ userId: p.userId, email: p.email, role: p.role, ... })`
  - Good: `register({ ...properties })`
  - The typed interface is the single source of truth. Only extract specific keys when the target API requires a different shape (e.g. Mixpanel's `$email` reserved field).

**Component Patterns**
- **Container/View separation**: Containers (smart) connect to Redux, Views (dumb) are pure presentation
- **Composition over inheritance**: Build complex UIs from simple, reusable components
- **Single responsibility**: Each component should do one thing well

**UI Design — avoid "AI slop" patterns**
- **Never use a colored accent bar on the left edge of a card/panel** (e.g. `borderLeft="3px solid <accent>"` to signal state). It reads as generic AI-generated design. Convey state with existing affordances instead (badges, toggles, text color, subtle bg tint).

### AI Orchestration & Tool Calling Architecture

The orchestrator (`frontend/orchestrator/`) is a **single-use** engine over an **append-only conversation log** (immutable, forkable, time-travel capable; forks on concurrent edits). Agents dispatch **tool calls**; each goes pending → execution → completed, and a job finishes when no pending tool calls remain. Tools and agents self-register (`V2_REGISTRABLES`); execution streams to the client via Server-Sent Events.

**Tools execute in the tier they need:**
- **Server tools** — run in-process during orchestration; need the document DB / connectors (querying data, searching schema, loading files: `ExecuteQuery`, `SearchDBSchema`, `ReadFiles`, `SearchFiles`).
- **Frontend-bridged tools** — need Redux/UI state (modifying the current question, editing dashboard layout, navigating); they throw `UserInputException` to pause the run and are executed in the browser via Redux middleware, then resume. Headless runs swap these for server equivalents where possible (`V2_HEADLESS_REGISTRABLES`; e.g. server-side `ReadFiles`).

**Tool call flow:**
```
User Input → orchestrator (server tools execute in-process) → pause on frontend tool
          → return pending → browser executes → resume orchestrator → … → finish
```
The orchestrator auto-executes every server tool, looping until it hits a frontend-only tool, then returns those to the client; completed results flow back in to resume. **Mixed completion:** when a pass yields both completed and pending work, record completions *before* returning pending items — breaking early loses completed results.

**AI chat contexts** (each sends relevant app state to the orchestrator): **Explore** (full-page chat for ad-hoc SQL), **Question** (sidebar with current query/params/results), **Dashboard** (sidebar with dashboard assets + layout).

### Chat Tool Display Architecture

The chat UI has two view modes: **Compact** (inline tool rows via `SimpleChatMessage` → `ToolCallDisplay`) and **Detailed** (timeline + carousel via `AgentTurnContainer`).

**Key components:**
- `AgentTurnContainer.tsx` — groups messages into turns (user msg → working area → reply). Working area = timeline rail (left) + detail carousel (right)
- `DetailCarousel.tsx` — shared carousel wrapper with header, nav dots, error count. Also exports shared helpers: `parseToolArgs`, `parseToolContent`, `isToolSuccess`, `getToolNameFromMsg`, and the `DetailCardProps` interface
- `tool-config.ts` — centralized config per tool: `displayComponent` (compact), `tier`, `chipLabel`, `chipIcon`, `timelineVerb`

**Each tool display file exports two things:**
1. **Default export** — compact inline display (used by `ToolCallDisplay`)
2. **Named `DetailCard` export** — card for the detail carousel (e.g., `NavigateDetailCard`, `EditFileDetailCard`, `FileDetailCard`)

**Routing in AgentTurnContainer:**
- `DETAIL_CARD_BY_TOOL` maps tool name → DetailCard component. Set to `null` to skip a tool in the carousel (e.g., `Clarify` is skipped because `ClarifyFrontend` covers it)
- `FILE_LABELS` (`created/edited/read`) check for chart items first → `ChartCarousel`, else route per tool name
- Messages are filtered (null-mapped tools removed), sorted (errors last), and error count shown in header

**Interactive tools (ClarifyFrontend, Navigate):** DetailCards check Redux for `pending_tool_calls` with unresolved `userInputs` and render `UserInputComponent` when pending.

**Color coding (compact displays):** Each tool type has a distinct accent color at `/8` opacity bg + `/15` border + colored icons + `fg.muted` text:
- Create: `accent.success` (green), Edit: `accent.secondary` (purple), Search: `accent.cyan` (turquoise), Read: `accent.primary` (blue), Navigate: `accent.teal`, Failed: `accent.danger` (red)

### Authentication & Access Control
- **Auth**: NextAuth v5 with session-based authentication
- **Authorization**: `getEffectiveUser()` checks permissions on every request
- **Admin users**: Can see all files and impersonate other users via `?as_user=email` URL parameter (home_folder required but not enforced)
- **Non-admin users**: Restricted to files in their `home_folder` (hierarchical)
- **User management**: All users managed via database and `/users` UI (legacy `users.yml` removed)
- **Required fields**: All users (including admins) must have `home_folder` set (default: `/org`)
- **Protected paths**: System prevents creation/modification of protected files (e.g., `/config/users.yml`)
- **Permission model**: File-path based with entity whitelisting (future)
- **Permission enforcement**: Three-layer defense (files.server.ts data layer → API routes → UI)
- **rules.json structure**: Defines allowedTypes, createTypes, editTypes, deleteTypes, viewTypes per role
- **Token versioning**: CURRENT_TOKEN_VERSION in auth.ts/auth-helpers.ts - increment to force re-login on JWT schema changes

### Mode-Based Isolation Pattern

The application supports mode-based file system isolation, similar to the `as_user` impersonation pattern:

- **Mode parameter flow**: URL param (`?mode=tutorial`) → middleware (`x-mode` header) → `EffectiveUser.mode`
- **Default mode**: 'org' (production files) - mode parameter hidden from UI when default
- **Alternate modes**: 'tutorial' (onboarding files), future modes for sandboxes/demos
- **Auto-initialization**: Both 'org' and 'tutorial' modes created automatically with file hierarchies when new company is created
- **File hierarchy**: Each mode has isolated file tree (e.g., `/org/...`, `/tutorial/...`)
- **Home folder resolution**: Users store relative home_folder (e.g., `sales/team1`), resolved at runtime:
  - `resolvePath(mode='org', home_folder='sales/team1')` → `/org/sales/team1`
  - `resolvePath(mode='tutorial', home_folder='')` → `/tutorial`
- **Mode + Impersonation**: Both patterns work together - admin can use `?as_user=bob@co.com&mode=tutorial`
- **Storage isolation**: All file operations (documents, conversations) respect mode

**Pattern consistency**: Mode follows exact same propagation pattern as `as_user` for architectural consistency.

### Parameter System
- **Syntax**: `:paramName` in SQL queries (e.g., `:limit`, `:start_date`)
- **Types**: `text`, `number`, `date`
- **Auto-extraction**: Parameters automatically detected from SQL
- **Dashboard merging**: Parameters with same name AND type merge at dashboard level
- **Type locking**: Types can change in question view, but locked in dashboard view

**Parameter value states:**
| State | JS value | SQL behavior |
|---|---|---|
| Has a value | `"foo"` / `100` | Filter condition included, `:param` substituted with the value |
| Empty **text** | `""` | A regular value — forwarded as-is (filter kept, `:param` bound to `""`) |
| Empty **number** | `""` → `null` | Normalized to None at param assembly (engines can't cast `""` to a number) — see `EmbeddedQuestionContainer` |
| **None** (explicit) | `null` | Filter condition removed via IR round-trip; any remaining `:param` refs replaced with `NULL` |

Server-side, `applyNoneParams` (`app/api/query/route.ts`) treats **only `null`** as None — an empty string is a real value, forwarded to the connector. So an empty **numeric** param is coerced `""`→`null` *client-side* where the values are assembled from their declared types (`EmbeddedQuestionContainer`), before it reaches the route. The UI exposes a "Set to None / Clear None" toggle (None = `null`).

**Dashboard fallback rule**: `effectiveSubmittedValues` uses the question's saved `parameterValues` default only when the key is **absent** from the dashboard's submitted params. An explicit `null` or `""` is never overridden by the question default — key-existence checks (`in`) are used, not `??`.

### Charting / Visualization Library

**Viz Types** (defined in `lib/types.ts` → `VizSettings`):
- `table` - Raw data table
- `line`, `bar`, `area`, `scatter` - Standard charts (ECharts)
- `funnel`, `pie` - Categorical charts
- `pivot` - Cross-tab pivot table with Rows/Columns/Values axes, per-value aggregation functions, heatmap, subtotals, and collapsible groups

`VizSettings` (in `lib/types.ts`) carries `type`, `xCols`/`yCols` (grouping/value columns for non-pivot types; values SUM-aggregated), and `pivotConfig` (pivot only).

**Key Files**:
- `components/plotx/ChartBuilder.tsx` - Main chart component with drag-drop axis selection
- `components/plotx/AxisComponents.tsx` - Shared drag-drop components (ColumnChip, DropZone, ZoneChip)
- `components/plotx/PivotAxisBuilder.tsx` - Pivot-specific Rows/Columns/Values drop zones with aggregation function selector
- `components/plotx/PivotTable.tsx` - Pivot table renderer with nested headers, subtotals, collapsible groups, heatmap
- `lib/chart/pivot-utils.ts` - Pure pivot aggregation logic (`aggregatePivotData()` → `PivotData`)
- `components/plotx/{LinePlot,BarPlot,PiePlot,...}.tsx` - Individual viz renderers
- `components/question/VizTypeSelector.tsx` - Viz type icon buttons
- `components/question/QuestionVisualization.tsx` - Routes to Table or ChartBuilder
- `lib/chart/chart-utils.ts` - Shared chart utilities (formatting, axis calculations)

**Chart → LLM Image Pipeline** (`lib/chart/chart-attachments.ts`):
On every message send from a question or dashboard page, `buildChartAttachments()` renders each chart off-screen via ECharts canvas, converts to JPEG (512px wide, 85% quality), uploads to S3 via presigned URL, and returns the public URL as an image attachment. Results are cached in-memory by `queryResultId|updatedAt|vizSettings|titleOverride|colorMode` — subsequent sends with unchanged data skip render+upload and reuse the cached S3 URL. These image attachments are sent to the LLM as content blocks between the app state block and the user message block.

**Adding a New Viz Type** — touch-points: add to the `VizSettings.type` union (`lib/types.ts`); add a renderer in `components/plotx/` (takes `ChartProps`) and export it from `components/plotx/index.ts`; wire it into `ChartBuilder.tsx`, `VizTypeSelector.tsx`, `QuestionVisualization.tsx`, and `handleVizTypeChange` in `QuestionViewV2.tsx`.

## Development Workflow

### Database Schema Changes
Update `lib/database/postgres-schema.ts` (PGLite uses this schema), update `lib/types.ts`, add a migration entry, then run `npm run update-workspace-template` to refresh the seed template.

### Adding Next.js API Routes

**Always use `handleApiError` in catch blocks** — never return `NextResponse.json({ error }, { status: 500 })` directly:
```typescript
import { handleApiError } from '@/lib/api/api-responses';

export async function POST(req: NextRequest) {
  try {
    // ...
  } catch (error) {
    return handleApiError(error); // reports to bug + returns consistent error shape
  }
}
```
`handleApiError` returns a consistent error shape for all unhandled errors. ESLint enforces this — a direct `NextResponse.json` with `{ status: 500 }` is a lint error in `app/api/**`. If a route genuinely needs a custom response shape for 500s (e.g. `/api/chat` returns `ChatResponse`), suppress inline with `// eslint-disable-next-line no-restricted-syntax` and ensure the error is reported via `appEventRegistry.publish(AppEvents.ERROR, ...)` manually. Error events are forwarded to the mx-llm-provider `/notify` endpoint, which routes `type: "error"` to Slack.

### Client-Side Error Handling

Browser-side complement to `handleApiError`:
- `lib/utils/error-parser.ts` — `parseErrorMessage()` → `{ title, hint, details?, isNetworkError? }`; flags transport failures (`'failed to fetch'`, etc.) as `isNetworkError` so the UI shows a retryable "Couldn't load results" instead of a SQL error.
- `lib/messaging/capture-error.ts` — `captureError()` POSTs to `/api/capture-error` with exponential backoff + jitter and 60s dedup; best-effort, never throws.
- `lib/utils/semaphore.ts` — `Semaphore` (limit may be a getter for live runtime caps); used as `querySemaphore` in `file-state.ts`.

### Adding Agent Tools / Agents
1. Add a tool (`MXTool` subclass with a TypeBox param schema) or agent under `frontend/agents/**`
2. Register it in `lib/chat-orchestration-v2.server.ts` (`V2_REGISTRABLES`); headless runners use `V2_HEADLESS_REGISTRABLES`
3. Implement the client/server behavior in `tool-handlers.ts` (frontend bridge) / `tool-handlers.server.ts` (server) as needed
4. Keep the TypeBox param schema (colocated with the tool) and the handler behavior in sync — the schema is the single source of truth for the args the LLM is told it can pass

## Important Technical Details

### Frontend
- **React 19** with Next.js 16 (App Router)
- **Chakra UI v3** with custom theme (Flat UI colors)
- **Redux Toolkit** for state management
- **@electric-sql/pglite** for embedded Postgres (open-source); `pg` for external Postgres (hosted)
- **Monaco Editor** for SQL editing
- **ECharts 6** for visualizations (themed with JetBrains Mono fonts)
- **NextAuth v5** for authentication

### AI Orchestration (in-process)
- **TypeScript orchestrator** (`frontend/orchestrator/` + `frontend/agents/`): LLM calls, append-only conversation log, tool/skill schemas — runs inside the Next.js app
- **Analytics queries** run in the Next.js Node.js connectors (`frontend/lib/connections/`)
- **Path Resolution**: DuckDB file paths are resolved relative to `BASE_DUCKDB_DATA_PATH` environment variable
  - Absolute paths (starting with `/`) are used as-is
  - Relative paths are prepended with `BASE_DUCKDB_DATA_PATH`
  - Default `BASE_DUCKDB_DATA_PATH` is `.` (current directory)

### Database
- **PGLite** (embedded, open-source) or **Postgres** (hosted): Documents, metadata, configuration
- **DuckDB**: Default analytics database (local)
- **BigQuery/PostgreSQL**: Optional external data warehouses

### Environment Variables

#### Frontend & Backend
- `BASE_DUCKDB_DATA_PATH`: Base directory for resolving DuckDB file paths (default: `.`)
  - **Dev**: Set to `..` (both frontend and backend run from their respective subdirectories)
  - **Prod**: Set to `/app` (Docker container working directory)
  - **Usage**: Relative paths in DuckDB connection configs are resolved relative to this path
  - **Example**: With `BASE_DUCKDB_DATA_PATH=..` and `file_path: "data/default_db.duckdb"`, resolved path is `../data/default_db.duckdb`
  - **Note**: Replaces the old `DEFAULT_DUCKDB_PATH` variable which only stored the filename

#### Frontend
- `DATABASE_URL`: Postgres connection URL (hosted only; open-source uses PGLite, set `DB_TYPE=pglite`)
- `PGLITE_DATA_DIR`: Directory for PGLite persistence (default: derived from `BASE_DUCKDB_DATA_PATH`)
- `NEXTAUTH_SECRET`: NextAuth secret for session encryption
- `NEXTAUTH_URL`: NextAuth URL (default: `http://localhost:3000`)
- `MAX_CONCURRENT_QUERIES`: max concurrent client `/api/query` calls (default: `10`); hydrated SSR → `configsSlice.maxConcurrentQueries`, read live by `querySemaphore` via `selectMaxConcurrentQueries`
- `QUERY_CACHE_TTL_MS`: TTL for the server-side `queryCache` (default: `60000`)

**Runtime-config → Redux pattern:** server config read in `lib/config.ts` → Redux `preloadedState` at SSR → consumed via selector; `Semaphore` takes a *getter* limit so Redux changes apply without recreating it.

#### Accessing env vars in code
- **Server-only vars** (secrets, DB URLs, internal flags): import from `frontend/lib/config.ts` — has `import 'server-only'` guard, throws at build time if a client component imports it.
- **Client-safe vars** (`NEXT_PUBLIC_*` and `NODE_ENV`): import from `frontend/lib/constants.ts` — safe for both server and browser.
- **Never access `process.env` directly** outside these two files. ESLint enforces this via `no-restricted-syntax`.

## Key Files Reference

### Frontend Core Modules

> **CRITICAL — always reuse, never re-implement.** `file-state.ts` and `file-state-hooks.ts` are the single source of truth for all file and query operations in the frontend. Before writing any new fetch, Redux read, or file-operation logic, read these files first. Duplicating their functionality elsewhere is a code smell.

- `frontend/lib/api/file-state.ts` - **CORE: Centralized file operations** — the only place file fetching, editing, saving, deleting, folder loading, and query execution logic should live. Key exports: `loadFiles`, `readFiles`, `readFolder`, `editFile`, `publishFile`, `deleteFile`, `getQueryResult` (accepts `{ forceLoad }` to bypass the query cache; calls bounded by `querySemaphore`).
- `frontend/lib/hooks/file-state-hooks.ts` - **CORE: React hooks** wrapping `file-state.ts` — the only hooks components should use for file/query data. Key exports: `useFile`, `useFolder`, `useFileByPath`, `useFilesByCriteria`, `useQueryResult` (returns `refetch()` for force-reload / retry).

**FilesAPI dual-implementation pattern:** A shared interface defines the contract for all file CRUD operations. There is a client implementation (HTTP calls) and a server implementation (direct DB access), both exported as `FilesAPI` from their respective modules. `file-state.ts` uses the client `FilesAPI` and adds Redux state management on top. **When adding a new file operation, add it to the interface and implement it in both client and server.** Never bypass `FilesAPI` with raw `fetch` calls.

> **⚠️ `DocumentDB` should only be used inside the server-side `FilesAPI` implementation.** Do not call `DocumentDB` directly from API routes, tool handlers, job handlers, or anywhere else — go through `FilesAPI` instead. Direct `DocumentDB` usage outside the data layer is a code smell.

- `frontend/lib/database/documents-db.ts` - Document DB CRUD operations (PGLite or Postgres)
- `frontend/lib/types.ts` - TypeScript interfaces. Imports shared types from `@/lib/validation/atlas-schemas`; defines frontend-only types and extends the shared ones (e.g. `QuestionContent` adds `queryResultId`)
- `frontend/lib/validation/atlas-schemas.ts` - **TypeBox single source** for Atlas file types (schemas + `Static` types). Edit here; `lib/validation/atlas-json-schemas.ts` re-derives the JSON-Schema objects at module load (no codegen step). Import types from `@/lib/validation/atlas-schemas` or `@/lib/types`.

### Frontend State & Components
- `frontend/store/` - Redux store with multiple domain slices:
  - `filesSlice.ts` - File/document state management
  - `chatSlice.ts` - Chat conversation state
  - `queryResultsSlice.ts` - Query results cache
  - `connectionsSlice.ts` - Database connections
  - `contextsSlice.ts` - Context files
  - `authSlice.ts` - Authentication state
- `frontend/components/containers/` - Smart container components (QuestionContainerV2, DashboardContainerV2)
- `frontend/components/views/` - View components (QuestionViewV2, DashboardView)
- `frontend/app/f/[id]/page.tsx` - File detail page route

### Frontend Other
- `frontend/scripts/update-workspace-template.ts` - Re-runs migrations on the seed template (`workspace-template.json`)
- `frontend/lib/database/import-export.ts` - Document import/export + `atomicImport` (seeds the DB at workspace registration)
- `frontend/lib/auth/access-rules.ts` - Server-side permission helpers (canEditFileType, canDeleteFileType, etc.)
- `frontend/lib/auth/access-rules.client.ts` - Client-side permission helpers (mirrors server functions)

### AI Orchestration & Connectors
- `frontend/orchestrator/` - the `Orchestrator` engine + conversation-log/LLM types
- `frontend/agents/` - agents, tools, and skills (e.g. `analyst/`, `web-analyst/`, `slack/`, `report/`, `eval/`)
- `frontend/lib/chat-orchestration-v2.server.ts` - wires agents/tools into `V2_REGISTRABLES` and runs chat turns
- `frontend/lib/connections/` - Node.js query connectors (DuckDB, BigQuery, PostgreSQL, SQLite, Athena, Mongo, CSV, Sheets) — query execution lives here

### Writing New Tests

**Chat/agent E2E tests run fully in-process** — there is no separate backend or LLM-mock server to spawn. The LLM is driven by each agent's **faux provider**: `import { fauxRegistration as X } from '@/agents/.../<agent>'` then `X.setResponses([fauxAssistantMessage(...) / fauxToolCall(...)])`. These tests:
- Test the full stack: Redux → Listener Middleware → API route → in-process orchestrator → faux LLM
- Use shared test utilities from `store/__tests__/test-utils.ts` (`setupTestDb` + `getTestDbPath`) and `test/harness/mock-fetch.ts` (`setupMockFetch` with the real route handlers)
- **Automatic tool execution**: observe automatic system behaviors (middleware, listeners) rather than manually simulating them

**Reference patterns:** `lib/integrations/slack/__tests__/slack.e2e.test.ts` (headless v2 orchestration via faux), `store/__tests__/storeE2E.test.ts` (in-process eval agent), and `app/api/chat/__tests__/v2-happy-path.test.ts` (chat route).

For component-level UI interaction tests (React rendering, user events, DOM assertions), use the `*.ui.test.tsx` naming convention — these run in the jsdom-based `ui` Vitest project (`npm run test:ui`, or `npx vitest run --project=ui <pattern>`). See `components/__tests__/agent-e2e.ui.test.tsx` and `components/__tests__/streaming-render.ui.test.tsx` for the reference pattern (in-process orchestrator + faux LLM, Redux, async agent flow + tool execution, `waitFor` assertions) and `components/__tests__/chat-input.ui.test.tsx` for chat-input interaction patterns.

**UI test element queries: `aria-label` ONLY.** Never use `getByRole`, `getByText`, `getByPlaceholderText`, `getByTestId`, or any other query strategy. Every interactive element must be located exclusively via `getByLabelText` / `findByLabelText` (which matches `aria-label`). If an element lacks an `aria-label`, add one to the component — do not work around it with a different query.

## Atlas Schemas (TypeBox)

**Single source of truth:** `frontend/lib/validation/atlas-schemas.ts` defines TypeBox schemas for all shared Atlas file types (`VizSettings`, `PivotConfig`, `QuestionContent`, `DashboardContent`, `FileReference`, `DashboardLayoutItem`, etc.). Each `export const X = Type.Object(...)` is BOTH a runtime JSON Schema and a static type via the colocated `export type X = Static<typeof X>`.

**Pipeline (no codegen — pure in-process):**
1. `frontend/lib/validation/atlas-json-schemas.ts` rebuilds the JSON-Schema objects at module load: full `atlasSchema` and the viz-stripped `atlasSchemaNoViz`. TypeBox's `Symbol(Kind)` metadata is dropped via `JSON.parse(JSON.stringify(...))` so Ajv sees a clean object.
2. Consumers of `atlasSchema` import directly from there: `lib/validation/content-validators.ts` (Ajv compile — `ajv.addSchema(atlasSchema, 'atlas')`) and `lib/data/file-markup.ts` + `lib/data/content-jsx.ts` (use `atlasSchema.$defs` to resolve `$ref`s when converting content ↔ JSX markup). The **EditFile / CreateFile tool descriptions do NOT embed the schema** — per-file-type markup is documented in each type's skill (`skill_questions`, `skill_dashboards`, `skill_reports`, `skill_alerts`, `skill_data_stories`, `skill_notebooks` in `orchestrator/prompts/prompts.yaml`); the tool description (`agents/web-analyst/web-tools.ts` → `MARKUP_FORMAT`) carries only the generic markup mechanics + a pointer to those skills. `atlasSchemaNoViz` currently has no production consumer (referenced only by schema tests).
3. Types come directly from `Static<typeof …>` — consumers import from `@/lib/validation/atlas-schemas`; `frontend/lib/types.ts` re-exports them and adds frontend-only fields.

**Key rules:**
- Edit `atlas-schemas.ts`; everything else re-derives on the next module load. No `npm run generate-types` step, no `*.gen.json` artifacts.
- `StringEnum` uses a `const` type param so literal arrays narrow to a union (not `string`).
- Frontend-only fields (e.g. `queryResultId` on `QuestionContent`) go in `types.ts` as interface extensions.
- `DocumentContent` (frontend abstraction for dashboards/notebooks) lives in `types.ts` only — it's more general than `DashboardContent`.

## Tool Schemas

Frontend tool arg schemas are TypeBox `Type.Object` definitions colocated with the tool (`frontend/agents/**`). They are the single source of truth for what args the LLM is told it can pass — keep the schema and the `tool-handlers.ts` / `tool-handlers.server.ts` behavior (which produces the return shape) in sync.

## Previous Mistakes

**Scripts belong in `frontend/scripts/` as Node.js (tsx).** The frontend already has all needed dependencies (`@duckdb/node-api`, `@aws-sdk/client-s3`, `dotenv`); use `import { config } from 'dotenv'; config()` to load `frontend/.env`, and add an entry to `frontend/package.json`.

**Schema changes:** Any change to `lib/database/postgres-schema.ts` (used by both PGLite and the Postgres adapter) must be accompanied by the appropriate migration entry.

**Tool Registration:** When a tool spawns another tool (via `FrontendToolException`) or an agent dispatches a sub-agent, the spawned class MUST be in `V2_REGISTRABLES` (`lib/chat-orchestration-v2.server.ts`) — the orchestrator instantiates it from that registry by `schema.name` when resuming / reconstructing a saved conversation log.

**Debugging Async Orchestration:** Debug multi-tier async execution by adding temporary logging at tier boundaries (orchestrator stream events, tool execution results) to trace data flow through the execution loop.

**TalkToUser is NOT a normal tool_call for most agents — do not mock it as one.** `TalkToUser` is only in `SlackAgent`'s toolset (so the bot can post back to Slack threads). All other agents (`AnalystAgent`, `DashboardAgent`, etc.) reply via `stopReason: 'stop'` with plain `content` — `TalkToUser` is never in their tool list. In tests, the correct faux pattern for a non-Slack agent reply is `fauxAssistantMessage('reply text', { stopReason: 'stop' })`. Mocking TalkToUser as a `fauxToolCall` for non-Slack agents will fail (the orchestrator can't resolve it) and produce the "I do not have a text reply" fallback — always use `stopReason: 'stop'` with content instead.

## Past Learnings

**Context fullSchema Semantics:** The `fullSchema` field in a context represents what tables/schemas are AVAILABLE for that context to whitelist (inherited from parent or loaded from connections), NOT what the context has actually whitelisted. The context's own `databases[].whitelist` array determines what it actually exposes. When a parent context applies `childPaths` restrictions on whitelist items, those restrictions filter what appears in the child's `fullSchema` - effectively limiting what the child CAN whitelist, not what it HAS whitelisted.