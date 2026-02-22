# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MinusX is an agentic, file-system based BI Tool that combines:
- **Frontend**: Next.js 16 + React 19 + Chakra UI v3 + Redux
- **Backend**: Python FastAPI for query execution and data pipeline orchestration
- **Storage**: SQLite/Postgres for documents (questions, dashboards), DuckDB/BigQuery/PostgreSQL for analytics
- **Architecture**: Dual-database system with integer ID-based file access, hierarchical permissions, and mode-based file system isolation

## Common Development Commands

### Frontend (Next.js)
```bash
cd frontend
npm run dev                # Start dev server (http://localhost:3000)
npm run typecheck          # Fast type checking (use this to validate code)
npm run validate           # Type check + lint (comprehensive validation)
npm run build              # Production build (slow, use only before deployment)
npm run lint               # Run ESLint
npm run import-db          # Initialize database if missing, skip if exists (safe default)
npm run import-db -- --replace-db=y  # Force replace existing database
npm run export-db          # Export database to STDOUT
npm run create-empty-db    # Create empty database
npm run generate-types     # Regenerate frontend/lib/types.gen.ts from Pydantic models
```

**IMPORTANT: Always use `npm run typecheck` or `npm run validate` to quickly verify code correctness. Do NOT use `npm run build` for validation - it's too slow and memory-intensive. Only run `npm run build` before deployment.**

### Backend (Python FastAPI)
```bash
cd backend
uv run uvicorn main:app --reload --reload-include='*.yaml' --port 8001    # Start backend server
```

The backend runs at http://localhost:8001 and handles:
- SQL query execution (`POST /api/execute-query`)
- Connection management and pooling

### Database Management

**Initialize from seed data:**
```bash
cd frontend
npm run import-db -- --replace-db=y
```
This creates `atlas_documents.db` from `lib/database/init-data.json` (includes sample questions and dashboards).

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

**Advanced: Selective company import:**
```bash
cd frontend
npm run import-db -- path/to/export.json.gz    # Interactive selection from custom file
npm run import-db                              # Safe default: init if missing, skip if exists
cat backup.json | npm run import-db -- --stdin --replace-db=y  # Pipe from stdin
```

The `import-db` script supports:
- **--stdin**: Read JSON from stdin instead of file path
- **--default**: Use `lib/database/init-data.json` as input (automatic if no file)
- **--all**: Auto-select all companies (automatic with --default)
- **--replace-db=y**: Replace database if exists (skip confirmation)
- **--replace-db=n**: Exit early if database exists (DEFAULT - safe for restarts)

### Database Migrations

To add a data migration:
1. Increment `LATEST_DATA_VERSION` in `lib/database/constants.ts`
2. Add a `MigrationEntry` to `MIGRATIONS` array in `lib/database/migrations.ts`
3. Migration runs automatically on `npm run import-db`

## High-Level Architecture

### Dual-Database System

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                            │
│                   (Next.js 16 + React 19)                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SQLite (atlas_documents.db)                                │
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

**Document Storage (SQLite)**
- All documents stored in `atlas_documents.db` with WAL mode
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

- **Storage**: Document at `/configs/config.json` (per company, isolated by `company_id`)
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
- **Configs + Contexts**: Always load on server-side render (SSR) with Next.js `unstable_cache` (5-min revalidate, separate cache keys per company)
- **Connections**: 50ms timeout on SSR, client-side fallback if exceeded
- **Server hydration**: All three resources (configs, contexts, connections) passed to Redux as `preloadedState`
- **Client fallback**: API routes (`/api/configs`, `/api/contexts`, `/api/connections`) available if data not SSR'd

**Merge Behavior**:
- Database values override hardcoded defaults from `frontend/lib/branding/whitelabel.ts`
- If config document doesn't exist, falls back to hardcoded `COMPANY_BRANDING` object
- Partial configs supported: only specified fields override, others use defaults

**Cache Invalidation**:
- Automatic revalidation after 5 minutes (Next.js `unstable_cache`)
- Manual revalidation: restart server or use `revalidateTag('configs')`
- Cache keys include `company_id` to prevent cross-company collisions

**Client Usage**:
```typescript
import { useConfigs } from '@/lib/hooks/useConfigs';
import { getCompanyBranding } from '@/lib/branding/whitelabel';
import { useAppSelector } from '@/store/hooks';

const { branding } = useConfigs();
const companyName = useAppSelector(state => state.auth.user?.companyName);

// Use branding from Redux if available, fall back to hardcoded
const finalBranding = branding || getCompanyBranding(companyName);

// Access branding properties
const logoSrc = colorMode === 'dark' ? finalBranding.logoDark : finalBranding.logoLight;
const agentName = finalBranding.agentName;
const displayName = finalBranding.displayName;
```

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
3. Next.js fetches connection config from SQLite
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
└── data/            # Database files (SQLite documents, DuckDB analytics)
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

**Component Patterns**
- **Container/View separation**: Containers (smart) connect to Redux, Views (dumb) are pure presentation
- **Composition over inheritance**: Build complex UIs from simple, reusable components
- **Single responsibility**: Each component should do one thing well

**ESLint Configuration**
To prevent inline imports, add this to your `.eslintrc`:
```json
{
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "ImportExpression",
        "message": "Dynamic imports are not allowed. Use static imports at the top of the file. Inline imports indicate circular dependencies or poor architecture."
      }
    ]
  }
}
```

**Progressive Onboarding (GettingStartedV2)**
- `components/GettingStartedV2.tsx` - Progressive onboarding banner/empty state
- Shows contextual CTAs based on what's missing: conversations → connections → contexts → questions → dashboards
- Two variants: `banner` (above file list) and `empty` (centered in empty folders)
- Tracks click state locally to immediately advance steps (refreshes to actual state)
- `GettingStartedSection.tsx` (legacy) only shows in tutorial mode

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

**Pivot Table Architecture**:
- Pivot uses its own config (`PivotConfig`) instead of `xCols`/`yCols`: `rows` (dimension columns for row headers), `columns` (dimension columns for column headers), `values` (measures with per-value `AggregationFunction`: SUM/AVG/COUNT/MIN/MAX)
- `ChartBuilder.tsx` branches on `chartType === 'pivot'`: renders `PivotAxisBuilder` instead of X/Y drop zones, calls `aggregatePivotData()` instead of `aggregateData()`, passes `PivotData` to `PivotTable`
- `PivotTable.tsx` renders multi-level nested row/column headers via `rowSpan`/`colSpan`, subtotal rows at group boundaries, collapsible groups (toggle on subtotal rows), teal heatmap gradient, row/column/grand totals
- Config changes propagate: `PivotAxisBuilder` → `ChartBuilder` → `QuestionVisualization` → `QuestionViewV2` → saved to `vizSettings.pivotConfig`

**Aggregation Logic** (`ChartBuilder.tsx` → `aggregateData()`):
- Groups rows by X-axis columns, sums Y-axis columns
- For multiple X columns: reorders by cardinality for `line/bar/area/scatter`, honors original order for `pie/funnel`
- Returns `{ xAxisData: string[], series: Array<{name, data}> }` format

**Adding a New Viz Type**:
1. Add type to `VizSettings.type` union in `lib/types.ts`
2. Create renderer component in `components/plotx/` (receives `ChartProps`)
3. Add case in `ChartBuilder.tsx` to render the component
4. Add icon/option in `VizTypeSelector.tsx`
5. Add type to condition in `QuestionVisualization.tsx`
6. Add type to `handleVizTypeChange` in `QuestionViewV2.tsx`
7. Export from `components/plotx/index.ts`

### Chat API Integration
The application uses an internal orchestration API for AI-powered chat functionality.

**Architecture:**
- **Frontend**: ChatInterface component → POST /api/chat
- **Backend**: Next.js API route handles orchestration + automatic tool execution
- **Python**: FastAPI backend (port 8001) executes agent logic
- **Storage**: Conversations stored as files in SQLite (/logs/conversations/)

**API Flow:**
1. User sends message → ChatInterface → POST /api/chat
2. Next.js loads conversation log from file storage
3. Forwards to Python backend with full context
4. Python executes agent + tools (server-side automatic loop)
5. Returns completed_tool_calls and updated log
6. Next.js appends to conversation file (with fork detection)
7. Frontend updates Redux state and UI

**Key Features:**
- Server-side automatic tool execution
- Append-only conversation log with conflict detection
- Conversation forking for concurrent edits
- Redux state management for reactivity

## Development Workflow

### Database Schema Changes
When modifying SQLite schema:
1. Update schema in `lib/database/documents-db.ts`
2. Update TypeScript interfaces in `lib/types.ts`
3. Export current data: `npm run export-db`
4. Modify migration or init script
5. Re-initialize: `npm run import-db -- --replace-db=y`
6. Test with existing seed data

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
- **better-sqlite3** for direct SQLite access in server components
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
- **SQLite** (WAL mode): Documents, metadata, configuration
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
- `DATABASE_URL`: SQLite database path (default: `data/atlas_documents.db`)
- `NEXTAUTH_SECRET`: NextAuth secret for session encryption
- `NEXTAUTH_URL`: NextAuth URL (default: `http://localhost:3000`)

## Key Files Reference

### Frontend Core Modules

> **CRITICAL — always reuse, never re-implement.** `file-state.ts` and `file-state-hooks.ts` are the single source of truth for all file and query operations in the frontend. Before writing any new fetch, Redux read, or file-operation logic, read these files first. Duplicating their functionality elsewhere is a code smell.

- `frontend/lib/api/file-state.ts` - **CORE: Centralized file operations** — the only place file fetching, editing, saving, deleting, folder loading, and query execution logic should live. Key exports: `loadFiles`, `readFiles`, `readFolder`, `editFile`, `publishFile`, `deleteFile`, `getQueryResult`, `createVirtualFile`.
- `frontend/lib/hooks/file-state-hooks.ts` - **CORE: React hooks** wrapping `file-state.ts` — the only hooks components should use for file/query data. Key exports: `useFile`, `useFolder`, `useFileByPath`, `useFilesByCriteria`, `useQueryResult`.
- `frontend/lib/database/documents-db.ts` - SQLite CRUD operations
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

## Previous Mistakes

**Tool Registration:** When a tool spawns another tool via `FrontendToolException`, the spawned tool MUST be registered with `@register_agent` because the Python orchestrator needs to instantiate it from the registry when processing the conversation log.

**Module Import Timing (BACKEND_URL):** When testing API routes that use `BACKEND_URL` constant, always use `setupMockFetch()`. Without it, `BACKEND_URL` is evaluated at module import time (before test port allocation), causing fetch calls to default port 8001 instead of dynamic test port. `setupMockFetch()` intercepts and redirects port 8001 → test port.

**Debugging Async Orchestration:** Debug multi-tier async execution by adding temporary logging at tier boundaries (Python response, tool execution results) to trace data flow through execution loop

## Past Learnings

**Context fullSchema Semantics:** The `fullSchema` field in a context represents what tables/schemas are AVAILABLE for that context to whitelist (inherited from parent or loaded from connections), NOT what the context has actually whitelisted. The context's own `databases[].whitelist` array determines what it actually exposes. When a parent context applies `childPaths` restrictions on whitelist items, those restrictions filter what appears in the child's `fullSchema` - effectively limiting what the child CAN whitelist, not what it HAS whitelisted.