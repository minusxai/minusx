# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Project Overview

MinusX is an agentic, file-system based BI Tool that combines:
- **Frontend**: Next.js 16 + React 19 + Chakra UI v3 + Redux
- **Backend**: Python FastAPI for query execution and data pipeline orchestration
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
npm run import-db          # Initialize database if missing, skip if exists (safe default)
npm run import-db -- --replace-db=y  # Force replace existing database
npm run export-db          # Export database to STDOUT
npm run create-empty-db    # Create empty database
npm run generate-types     # Regenerate frontend/lib/types.gen.ts from Pydantic models
```

**IMPORTANT: Always use `npm run validate` to quickly verify code correctness. Do NOT use `npm run build` for validation - it's too slow and memory-intensive. Only run `npm run build` before deployment.**

### Backend (Python FastAPI)
```bash
cd backend
uv run uvicorn main:app --reload --reload-include='*.yaml' --port 8001    # Start backend server
uv run ruff check .    # Lint (use this to validate code)
uv run pytest          # Run tests
```

**IMPORTANT: Always use `uv run ruff check .` to quickly verify Python code correctness before committing.**

The backend runs at http://localhost:8001 and handles:
- SQL query execution (`POST /api/execute-query`)
- Connection management and pooling

### Database Management

**Initialize from seed data:**
```bash
cd frontend
npm run import-db -- --replace-db=y
```
Seeds the database from `lib/database/init-data.json` (includes sample questions and dashboards).

**Export current database:**
```bash
cd frontend
npm run export-db
```
Exports all documents to STDOUT for version control or sharing.

**Typical workflow:**
1. Export: `npm run export-db`
2. Edit: Modify `lib/database/init-data.json`
3. Re-initialize: `npm run import-db -- --replace-db=y`

### Database Migrations

**Documents DB (PGLite/Postgres)** — uses a versioned migration framework:
1. Increment `LATEST_DATA_VERSION` in `lib/database/constants.ts`
2. Add a `MigrationEntry` to `MIGRATIONS` array in `lib/database/migrations.ts`
3. Migration runs automatically on `npm run import-db`

**Analytics DuckDB** (`frontend/lib/analytics/file-analytics.db.ts`) — has no migration framework. `initSchema()` runs `CREATE TABLE/INDEX IF NOT EXISTS` once per process restart, which is a no-op on existing databases. To add new columns to an existing table, append `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` guards to `SCHEMA_SQL` after the relevant `CREATE TABLE` block. These guards are idempotent (no-op on fresh installs) and fire automatically on each server restart.

**App Event Registry** (`frontend/lib/app-event-registry/`) — a lightweight server-side pub/sub system for app-level events (file operations, LLM calls, query executions, etc.). API routes publish typed events via `appEventRegistry.publish(AppEvents.X, payload)`; analytics handlers subscribe centrally in `index.ts` rather than being scattered across call sites. Always use this pattern when adding new analytics tracking — never call analytics functions directly from API routes or business logic.

## High-Level Architecture

### Dual-Database System

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                            │
│                   (Next.js 16 + React 19)                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PGLite (open-source) or Postgres (DATABASE_URL)            │
│  ├─ Questions, Dashboards, Notebooks, Presentations         │
│  ├─ Connections, Context, Users, Folders                    │
│  └─ Accessed directly by Next.js server components          │
│                                                             │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      │ API Calls
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend (Python FastAPI)                  │
├─────────────────────────────────────────────────────────────┤
│  ├─ Query Execution (SQLAlchemy)                            │
│  ├─ Connection Pooling                                      │
│  └─ Schema Introspection                                    │
│                                                             │
│  DuckDB / BigQuery / PostgreSQL                             │
│  └─ Actual business data for analytics                      │
└─────────────────────────────────────────────────────────────┘
```

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
- `notebook` - Vertical notebook-style view (future)
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
1. User edits SQL in QuestionViewer → Redux tracks state
2. Execute query → `POST /api/query` (Next.js)
3. Next.js fetches connection config from the document DB
4. Forward to Python backend → `POST /api/execute-query`
5. Python executes via SQLAlchemy with connection pooling
6. Return QueryResult (columns, types, rows)
7. Visualization updates with data

**State Management**
- Redux for page-level state (questions, dashboards)
- Dual-state pattern: `originalState` (from DB) vs `currentState` (edited)
- Dirty detection: Compare states via JSON serialization
- After save: Update `originalState` to match `currentState`

### Directory Structure

```
minusx/
├── frontend/         # Next.js 16 application (React 19, Chakra UI, Redux)
│   ├── app/         # Next.js App Router (pages, API routes)
│   ├── components/  # React components
│   ├── lib/         # Utilities, API clients, types
│   └── store/       # Redux store and slices
├── backend/         # Python FastAPI backend (query execution, connections)
└── data/            # Database files (PGLite documents, DuckDB analytics)
```

## Key Design Patterns

### Development Patterns & Best Practices

**Custom Hooks for Data Loading**
- Use specialized hooks to load and manage different file types
- **`useFile(id)`** - Load any file by ID, handles loading states and caching
- **`useFolder(path)`** - Load folder contents and metadata
- **`useConversation(id)`** - Load conversation logs with message history
- These hooks abstract Redux state management and API calls
- Automatically handle loading, error states, and refetching logic

**Code Smells to Avoid**
- **Excessive `useEffect` usage** is a red flag
  - Most data fetching should use custom hooks (useFile, useFolder, etc.)
  - Avoid cascading effects that trigger other effects
  - Prefer declarative patterns over imperative effect chains
  - If you find yourself writing multiple interdependent useEffects, refactor
- **Inline/dynamic imports** - ALWAYS import at the top of the file
  - Inline imports like `const { foo } = await import('./bar')` are a code smell
  - They indicate circular dependencies or poor module design
  - Fix the architecture instead of using inline imports as a workaround
  - ESLint rule `no-restricted-syntax` prevents inline imports
- **Circular dependencies** - Design around them, don't inline import
  - Circular dependencies indicate architectural issues
  - Extract shared code to a separate module
  - Use dependency inversion or other design patterns
  - Never use inline imports to "fix" circular dependencies
- **Direct Redux state mutation** - Always use slice actions
- **Prop drilling** - Use Redux or context for deeply nested data
- **Inline API calls in components** - Use custom hooks or listener middleware
- **Explicit key enumeration** - Never manually re-list every field of a typed object when you can pass or spread the object directly. This causes change amplification: adding a new field to an interface requires hunting down every place keys were listed and updating them all, and you WILL miss some.
  - Bad: `register({ userId: p.userId, email: p.email, role: p.role, ... })`
  - Good: `register({ ...properties })`
  - The typed interface is the single source of truth. Pass it through; let the consumer spread or destructure as needed. Only extract specific keys when the target API requires a different shape (e.g. Mixpanel's `$email` reserved field).

**Component Patterns**
- **Container/View separation**: Containers (smart) connect to Redux, Views (dumb) are pure presentation
- **Composition over inheritance**: Build complex UIs from simple, reusable components
- **Single responsibility**: Each component should do one thing well

### AI Orchestration & Tool Calling Architecture

**Three-Tier System**
The application uses a multi-tier architecture for AI-powered features:

1. **Next.js Frontend**: React UI, Redux state management, user interactions
2. **Next.js Backend**: API routes, document database access, query coordination
3. **Python Backend**: Stateless orchestration engine, LLM calls, database connections, query execution

**Orchestration Pattern**
- Python backend manages an **append-only conversation log** (immutable, forkable, time-travel capable)
- Agents dispatch **tool calls** that execute across different tiers
- Each tool call goes through: pending → execution → completed cycle
- Job finishes when no pending tool calls remain

**Multi-Tier Tool Execution**
Tools can execute in three environments based on their requirements:

- **Python Backend Tools**: Execute immediately (e.g., sending messages, data transformations)
- **Next.js Backend Tools**: Require document database or API access (e.g., querying data, searching schema, loading files)
- **Frontend Tools**: Require Redux state or UI updates (e.g., modifying current question, editing dashboard layout) - execute automatically via Redux middleware, not manually

**Tool Call Flow**
```
User Input → Python (pending tools) → Next.js (execute some) → Frontend (execute rest)
         ← Python (resume)         ← Next.js (completed)   ← Frontend (completed)
```

1. Python orchestrator returns pending tool calls to Next.js
2. Next.js backend executes tools it can handle (database queries, file access)
3. Next.js returns tools it can't execute to frontend
4. Frontend executes remaining tools (UI updates via Redux)
5. Completed tool results return to Python to resume orchestration
6. Loop continues until no pending tools remain

**AI Chat Integration**
Conversational AI is integrated in three contexts:

- **Explore Page**: Full-page chat interface for ad-hoc SQL analysis
- **Question Page**: Sidebar chat with context of current SQL query, parameters, and results
- **Dashboard Page**: Sidebar chat with context of dashboard assets and layout

Each context sends relevant app state to the orchestrator, allowing the AI to understand and modify the current page.

**Key Patterns**
- **Stateless backend**: Python backend maintains no session state between requests
- **Append-only log**: Conversations are immutable logs that can fork on concurrent edits
- **Registry pattern**: Tools and agents register themselves for discoverability
- **Streaming**: Real-time updates via Server-Sent Events during execution
- **Automatic loop**: Next.js backend automatically executes tools until it encounters frontend-only tools
- **Mixed completion**: When execution yields both completed and pending work, record completions first before returning pending items - breaking early loses completed results

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

**Parameter value states** — a parameter can be in one of three states:
| State | JS value | SQL behavior |
|---|---|---|
| Has a value | `"foo"` / `100` | Filter condition included, `:param` substituted with the value |
| Empty | `""` | Treated as None — filter condition removed via IR, remaining `:param` refs replaced with `NULL` |
| **None** (explicit) | `null` | Same as empty — filter condition removed via IR, remaining `:param` refs replaced with `NULL` |

The UI exposes a "Set to None / Clear None" toggle on each parameter input. None is `null` in JS. The `applyNoneParams` function in `app/api/query/route.ts` handles both `null` and `""` identically: IR round-trip strips the filter condition; any remaining `:param` refs become `NULL`.

**Dashboard fallback rule**: `effectiveSubmittedValues` uses the question's saved `parameterValues` default only when the key is **absent** from the dashboard's submitted params. An explicit `null` or `""` is never overridden by the question default — key-existence checks (`in`) are used, not `??`.

### Charting / Visualization Library

**Viz Types** (defined in `lib/types.ts` → `VizSettings`):
- `table` - Raw data table
- `line`, `bar`, `area`, `scatter` - Standard charts (ECharts)
- `funnel`, `pie` - Categorical charts
- `pivot` - Cross-tab pivot table with Rows/Columns/Values axes, per-value aggregation functions, heatmap, subtotals, and collapsible groups

**VizSettings Interface**:
```typescript
interface VizSettings {
  type: 'table' | 'line' | 'bar' | 'area' | 'scatter' | 'funnel' | 'pie' | 'pivot';
  xCols?: string[];      // Grouping columns (used by non-pivot chart types)
  yCols?: string[];      // Value columns (aggregated with SUM, used by non-pivot chart types)
  pivotConfig?: PivotConfig;  // Only used when type === 'pivot'
}
```

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

**Adding a New Viz Type**:
1. Add type to `VizSettings.type` union in `lib/types.ts`
2. Create renderer component in `components/plotx/` (receives `ChartProps`)
3. Add case in `ChartBuilder.tsx` to render the component
4. Add icon/option in `VizTypeSelector.tsx`
5. Add type to condition in `QuestionVisualization.tsx`
6. Add type to `handleVizTypeChange` in `QuestionViewV2.tsx`
7. Export from `components/plotx/index.ts`

## Development Workflow

### Database Schema Changes
Update `lib/database/postgres-schema.ts` (PGLite uses this schema), update `lib/types.ts`, add a migration entry, then re-initialize: `npm run import-db -- --replace-db=y`.

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
`handleApiError` calls `notifyInternal` for all unhandled errors, ensuring they reach the bug channel. ESLint enforces this — a direct `NextResponse.json` with `{ status: 500 }` is a lint error in `app/api/**`. If a route genuinely needs a custom response shape for 500s (e.g. `/api/chat` returns `ChatResponse`), suppress inline with `// eslint-disable-next-line no-restricted-syntax` and ensure the error is reported via `AppEvents.ERROR` or `notifyInternal` manually.

### Adding Python Backend Endpoints
1. Add route handler in `backend/main.py`
2. Define Pydantic models for request/response
3. Use `connection_manager` for database connections
4. Add corresponding API client in `frontend/lib/api/`
5. Update TypeScript types if needed

## Important Technical Details

### Frontend
- **React 19** with Next.js 16 (App Router)
- **Chakra UI v3** with custom theme (Flat UI colors)
- **Redux Toolkit** for state management
- **@electric-sql/pglite** for embedded Postgres (open-source); `pg` for external Postgres (hosted)
- **Monaco Editor** for SQL editing
- **ECharts 6** for visualizations (themed with JetBrains Mono fonts)
- **NextAuth v5** for authentication

### Backend
- **FastAPI** with uvicorn
- **SQLAlchemy** for database operations
- **DuckDB**, **BigQuery**, **PostgreSQL** connectors
- **Connection pooling** for performance
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

#### Accessing env vars in code
- **Server-only vars** (secrets, DB URLs, internal flags): import from `frontend/lib/config.ts` — has `import 'server-only'` guard, throws at build time if a client component imports it.
- **Client-safe vars** (`NEXT_PUBLIC_*` and `NODE_ENV`): import from `frontend/lib/constants.ts` — safe for both server and browser.
- **Never access `process.env` directly** outside these two files. ESLint enforces this via `no-restricted-syntax`.

## Key Files Reference

### Frontend Core Modules

> **CRITICAL — always reuse, never re-implement.** `file-state.ts` and `file-state-hooks.ts` are the single source of truth for all file and query operations in the frontend. Before writing any new fetch, Redux read, or file-operation logic, read these files first. Duplicating their functionality elsewhere is a code smell.

- `frontend/lib/api/file-state.ts` - **CORE: Centralized file operations** — the only place file fetching, editing, saving, deleting, folder loading, and query execution logic should live. Key exports: `loadFiles`, `readFiles`, `readFolder`, `editFile`, `publishFile`, `deleteFile`, `getQueryResult`, `createVirtualFile`.
- `frontend/lib/hooks/file-state-hooks.ts` - **CORE: React hooks** wrapping `file-state.ts` — the only hooks components should use for file/query data. Key exports: `useFile`, `useFolder`, `useFileByPath`, `useFilesByCriteria`, `useQueryResult`.

**FilesAPI dual-implementation pattern:** A shared interface defines the contract for all file CRUD operations. There is a client implementation (HTTP calls) and a server implementation (direct DB access), both exported as `FilesAPI` from their respective modules. `file-state.ts` uses the client `FilesAPI` and adds Redux state management on top. **When adding a new file operation, add it to the interface and implement it in both client and server.** Never bypass `FilesAPI` with raw `fetch` calls.

> **⚠️ `DocumentDB` should only be used inside the server-side `FilesAPI` implementation.** Do not call `DocumentDB` directly from API routes, tool handlers, job handlers, or anywhere else — go through `FilesAPI` instead. Direct `DocumentDB` usage outside the data layer is a code smell.

- `frontend/lib/database/documents-db.ts` - Document DB CRUD operations (PGLite or Postgres)
- `frontend/lib/types.ts` - TypeScript interfaces. Imports shared types from `types.gen.ts`; defines frontend-only types and extends generated ones (e.g. `QuestionContent` adds `queryResultId`)
- `frontend/lib/types.gen.ts` - **Generated file — do not edit by hand.** Regenerate with `cd frontend && npm run generate-types` after changing Pydantic models in `backend/tasks/agents/analyst/file_schema.py`

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
- `frontend/scripts/import-db.ts` - Database import/initialization script
- `frontend/lib/auth/access-rules.ts` - Server-side permission helpers (canEditFileType, canDeleteFileType, etc.)
- `frontend/lib/auth/access-rules.client.ts` - Client-side permission helpers (mirrors server functions)

### Backend
- `backend/main.py` - FastAPI application with all endpoints
- `backend/connection_manager.py` - Database connection pooling
- `backend/connectors/` - Database connectors (DuckDB, BigQuery, PostgreSQL)

### Writing New Tests

**All new tests should be written as Redux integration E2E tests** (following the `chatE2E.test.ts` pattern). These tests:
- Test the full stack: Redux → Listener Middleware → API → Python Backend
- Provide realistic end-to-end coverage
- Use shared test utilities from `store/__tests__/test-utils.ts`
- **Automatic tool execution**: Tests should observe automatic system behaviors (middleware, listeners) rather than manually simulating them - manual intervention interferes with production flow

**Example:**
```typescript
import { waitFor, getTestDbPath } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { POST as chatPostHandler } from '@/app/api/chat/route';

describe('My New Feature', () => {
  const { getPythonPort } = withPythonBackend();
  const { getStore } = setupTestDb(getTestDbPath('my_feature'));
  const mockFetch = setupMockFetch({ getPythonPort, chatPostHandler });

  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should test my feature', async () => {
    const store = getStore();
    // Your test here
  });
});
```

See `store/__tests__/test-utils.ts` for available utilities and `chatE2E.test.ts` for complete examples.

**Test Ports:** Tests use ports 8002-8006 (distinct from dev servers on 3000 and 8001). Always check for stale test processes before running tests.

For component-level UI interaction tests (React rendering, user events, DOM assertions), use the `*.ui.test.tsx` naming convention with the JSDOM runner instead (`npx jest --config jest.config.ui.js`). See `components/__tests__/explore-chat.ui.test.tsx` for the reference pattern (Python backend, LLM mock server, Redux, async agent flow, `waitFor` assertions); see `components/__tests__/agent-creates-files.ui.test.tsx` for tool-execution patterns.

**UI test element queries: `aria-label` ONLY.** Never use `getByRole`, `getByText`, `getByPlaceholderText`, `getByTestId`, or any other query strategy. Every interactive element must be located exclusively via `getByLabelText` / `findByLabelText` (which matches `aria-label`). If an element lacks an `aria-label`, add one to the component — do not work around it with a different query.

## Pydantic → TypeScript Type Codegen

**Single source of truth:** `backend/tasks/agents/analyst/file_schema.py` defines Pydantic models for all shared Atlas file types (`VizSettings`, `PivotConfig`, `QuestionContent`, `DashboardContent`, `FileReference`, `DashboardLayoutItem`, etc.).

**Pipeline:**
1. Pydantic models emit a JSON schema via `ATLAS_FILE_SCHEMA_JSON`
2. `backend/scripts/export_schema.py` prints the schema to stdout
3. `json-schema-to-typescript` converts it to `frontend/lib/types.gen.ts`
4. `frontend/lib/types.ts` re-exports generated types and extends them with frontend-only fields

**When to regenerate:**
- After changing any Pydantic model in `file_schema.py`, run: `cd frontend && npm run generate-types`
- Commit the updated `types.gen.ts` — it's a tracked artifact (CI typechecks without Python)

**Key rules:**
- **Never edit `types.gen.ts` by hand** — changes are overwritten on next codegen
- Frontend-only fields (e.g. `queryResultId` on `QuestionContent`) go in `types.ts` as interface extensions, not in Pydantic
- Pydantic `Optional[T]` generates `T | null` in TypeScript (not `T | undefined`) — fix call sites with `?? undefined` where needed
- `DocumentContent` (frontend abstraction for dashboards/notebooks) lives in `types.ts` only — it's more general than the generated `DashboardContent`

## Prompt Size Measurement

After any change to agent prompts, tool docstrings, or field descriptions, measure the token impact with `cd frontend && MEASURE_PROMPT=1 npx jest promptMeasure --no-coverage --verbose`. This prints a full per-section breakdown of system prompt, user message, and tool schemas against a real dashboard app_state (baseline: ~17,226 tokens on 2026-04-13).

## Tool Schema Dual-Update Rule

**When modifying frontend tool handlers (`tool-handlers.ts`), always update the corresponding Pydantic class in `backend/tasks/agents/analyst/tools.py` too.** The Pydantic class is the source of truth for what args the LLM is told it can pass — stale schemas cause the model to use wrong/old args. Both files must stay in sync: `tools.py` defines the schema (args + docstring), `tool-handlers.ts` implements the behavior, and `tools.md` documents the return shape.

## Previous Mistakes

**Scripts belong in `frontend/scripts/` as Node.js (tsx), never Python.** The frontend already has all needed dependencies (`@duckdb/node-api`, `@aws-sdk/client-s3`, `dotenv`); use `import { config } from 'dotenv'; config()` to load `frontend/.env`, and add an entry to `frontend/package.json`.

**Schema changes:** Any change to `lib/database/postgres-schema.ts` (used by both PGLite and the Postgres adapter) must be accompanied by the appropriate migration entry.

**Tool Registration:** When a tool spawns another tool via `FrontendToolException`, the spawned tool MUST be registered with `@register_agent` because the Python orchestrator needs to instantiate it from the registry when processing the conversation log.

**Module Import Timing (BACKEND_URL):** When testing API routes that use `BACKEND_URL` constant, always use `setupMockFetch()`. Without it, `BACKEND_URL` is evaluated at module import time (before test port allocation), causing fetch calls to default port 8001 instead of dynamic test port. `setupMockFetch()` intercepts and redirects port 8001 → test port.

**Debugging Async Orchestration:** Debug multi-tier async execution by adding temporary logging at tier boundaries (Python response, tool execution results) to trace data flow through execution loop

**TalkToUser is NOT a normal tool_call for most agents — do not mock it as one.** `TalkToUser` is only in `SlackAgent`'s toolset (so the bot can post back to Slack threads). All other agents (`AnalystAgent`, `DashboardAgent`, etc.) reply via `finish_reason='stop'` with plain `content` — `TalkToUser` is never in their tool list. In tests, the correct mock pattern for a non-Slack agent reply is `{ response: { content: 'reply text', finish_reason: 'stop' } }`. Mocking TalkToUser as a tool_call for non-Slack agents will silently fail (Python won't recognise it) and produce the "I do not have a text reply" error. The `LLMMockServer.configure()` method enforces this: it throws if `tool_calls` contains TalkToUser — always use `finish_reason: 'stop'` with `content` instead, and let the Python backend handle reply formatting.

## Past Learnings

**Context fullSchema Semantics:** The `fullSchema` field in a context represents what tables/schemas are AVAILABLE for that context to whitelist (inherited from parent or loaded from connections), NOT what the context has actually whitelisted. The context's own `databases[].whitelist` array determines what it actually exposes. When a parent context applies `childPaths` restrictions on whitelist items, those restrictions filter what appears in the child's `fullSchema` - effectively limiting what the child CAN whitelist, not what it HAS whitelisted.