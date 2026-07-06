# Refactor v2 — Module Reorganization & Dead-Code Purge

**Source:** Full-codebase audit (2026-07-06) against *A Philosophy of Software Design* criteria — deep modules, small interfaces, no shallow/pass-through layers, no naming lies — plus a `knip` dead-code scan and per-plane grep-verified reviews (data, query/analytics, chat/AI, UI, app-routes).

**Tracking:** all work lands on branch `feature/refactor-v2`, tracked by PR #567 (`minusxai/minusx`). Commit and push to this PR continuously as each milestone completes — do not hoard everything for one final push. **Do not merge** — the PR is left open for manual review; getting every CI check green is the deliverable, not clicking merge.

**How to use this doc:**
- Milestones are ordered by risk/leverage AND by dependency — do them in order. M7 (repo rename) and M8 (docs) are deliberately last: the rename is pure mechanical path churn that should happen once, after content is stable, and docs should describe the *actual final* structure rather than a mid-refactor snapshot that then keeps moving under it.
- Every checkbox lists its evidence (file:line where relevant). **If reality disagrees with a claim here, stop and re-verify rather than forcing the change** — the codebase moves fast and some claims may drift stale.
- Items marked **[VERIFY-FIRST]** must be re-confirmed (grep / prod check) before acting.
- **Verification cadence — after every milestone (not just at the end):** `cd frontend && npm run validate && npm test`, then commit + push to PR #567. Milestones touching UI flows: also `npm run test:e2e`; touching QA-covered flows: `npm run test:qa`. `npm run validate` (typecheck+lint) does **not** catch behavior-preserving-refactor breakage — the test suite is what proves behavior didn't change; don't treat a clean `validate` as a green light on its own. Run `npm run build` at least once before the final push — Next.js route/server-boundary breaks (e.g. a `server-only` import leaking into a client bundle) surface only at build, never at `validate`.
- **When "do everything" collides with "do it correctly and verify it works,"correctness wins.** For high-risk, thin-test-coverage items (the `lib/types.ts` split in M3, the container/view rearchitecture in M4.2, god-component splits in M4.3), if behavior-preserving safety cannot be established with the existing tests (per the repo's Blue→Red→Blue rule: break the old code, confirm the test goes red, prove it's actually guarding the behavior), treat it the same way M6's VERIFY-FIRST items are treated: do the safe, verifiable part, and clearly document what's blocked and why, rather than pushing through an unverified change. A correct, honestly-annotated 90% beats a "complete" 100% that silently ships a behavior change no test caught.
- **Deletions are removals, not commenting-out.** When deleting a file, also delete its dedicated test file and any barrel-export lines referencing it.

**Do-NOT-touch list (audited healthy — leave alone):**
- `lib/object-store/` (textbook deep module), `lib/projection/`, `lib/query-cache/`, `lib/search/`
- `lib/connections/` architecture (3-method `NodeConnector` interface; `run-query.ts` single seam) — only the *duplication lifts* in M5 apply
- `lib/sql/sql-to-ir.ts` (1144 LOC but single-export deep module — size is fine)
- orchestrator ↔ agents boundary (engine imports zero agent code) and the agent inheritance chain (analyst / web-analyst / benchmark-analyst share tools via inheritance, no copy-paste)
- `plotx/` ↔ `lib/chart/` separation; `query-builder` live path (`QueryBuilderRoot → QueryBuilder/CompoundQueryBuilder → *Section` components)
- Redux store data design (`queryResultsSlice` = single source of truth; `filesSlice` stores `queryResultId` pointers; no cross-slice duplication)
- `lib/csv-processor.ts` vs `lib/csv-utils.ts` — deliberate server/client split, NOT duplication
- The two `ReadFiles` tool classes (server `agents/analyst/file-tools.ts:53` vs frontend `agents/web-analyst/web-tools.ts:137`) — intentional headless swap via `HEADLESS_TOOL_SWAPS`
- `local/` dir — intentional symlink extension point (`instrumentation.ts:21-23`)
- `benchmarks/` — live eval harness (`npm run benchmark:dab`), NOT dead despite knip flagging it (knip doesn't know npm-script entry points)

---

## Milestone 0 — Tooling & baseline

Make dead-code detection repeatable so later milestones can verify "zero regressions in deadness," and establish a known-good baseline before any content change.

- [ ] Establish the baseline (do this FIRST, before any edit): `npm install` (sync node_modules with package.json), then `npm run validate`, `npm test`, `npm run test:e2e`, `npm run test:qa`. Record pass/fail counts here. Any pre-existing red/flaky test is *not* this refactor's fault — note it and do not let it block progress, but don't silently "fix" it as a drive-by either; call it out.
- [ ] Add `knip` as a devDependency in `frontend/package.json` with a `knip.json` config that registers the entry points knip currently misses (these caused false positives in the audit scan):
  - Playwright setups: `test/e2e/auth.setup.ts`, `test/qa/auth.setup.ts`, `test/qa/reset.setup.ts`
  - npm-script entries: `benchmarks/dataanalystbench.ts` (via `benchmark:dab`), everything under `scripts/`
  - `lib/__checks__/config-constants-no-overlap.ts` **[VERIFY-FIRST]** — determine whether this is a compile-time-only check (if so, register as entry; if truly orphaned, delete it in M1)
- [x] Add an npm script `"knip": "knip --no-config-hints"` and record the baseline count of findings in this doc when M1 completes.
- [ ] (Optional) Add knip to CI as non-blocking reporting.

**Baseline results (2026-07-06, before any content change):**
- `npm run validate`: clean after `npm install` synced stale `node_modules` (pre-existing gap: `@types/jsdom` was declared in `package.json` but not installed locally — not a code bug, just a local env sync issue, fixed by `npm install`).
- `npm test`: **green** — 379 test files passed, 2 skipped (381 total); 4000 tests passed, 5 skipped (4005 total). Duration 83.79s.
- `npm run test:e2e`: **green** — 2 passed (setup + `chat-stream-reconnect.spec.ts`). (Faux-LLM "No more faux responses queued" lines in the log are expected noise from a micro-task exhausting its queued responses, not a test failure.)
- `npm run test:qa`: _pending, running_

**Knip baseline (post-config, 2026-07-06):** `knip.json` added, registering the false-positive entries the manual audit found (Playwright setups, `benchmarks/dataanalystbench.ts`, `scripts/*`, `lib/__checks__/*`). With those registered, the true count is:
- Unused files: **1** (`lib/auth/guest-rate-limit.ts` — matches the M1.2 VERIFY-FIRST item, now confirmed as the sole remaining orphan)
- Unused devDependencies: **2** (`tailwindcss`, `yaml-loader` — `tailwindcss` is a new finding beyond the original manual audit; **[VERIFY-FIRST]** before removing, since Next.js/PostCSS tooling can use it without a knip-visible import)
- Unlisted dependencies: **22** (all `@lexical/*` — same underlying gap the manual audit found, just itemized per line instead of per package)
- Unused exports: **325** (bigger than the manual audit's 128 — the manual list undercounted; this knip run is now the authoritative source for M1.6, superseding the hand-curated list there)
- Unused exported types: **205** (vs. manual audit's 72; same reason)
- Duplicate exports: **1** (`RemoteAnalystAgent`/`AnalystAgent` — matches the manual finding)

Full dump saved to session scratchpad (`knip-m0-baseline.txt`) as the M1.6 work queue's ground truth; M1.6's hand-curated groupings below remain a useful starting checklist but are not exhaustive — re-run `npm run knip` after M1 and sweep whatever it still reports.

---

## Milestone 1 — Dead-code purge (mechanical, grep-proven, zero product risk)

### 1.1 Dead component files (~1.7k LOC)

These are alive ONLY via barrel re-exports that nobody imports (grep-verified: each name appears only in its barrel + its own file).

- [ ] Delete `components/plotx/Table.tsx` (608 LOC; superseded by `TableV2`, which is what `components/question/QuestionVisualization.tsx` uses). Remove its export from `components/plotx/index.ts`. If `Table.tsx` has any `formatValue` logic `TableV2` lacks, fold it in first (both define their own `formatValue`).
- [ ] Delete the superseded query-builder generation + their `components/query-builder/index.ts` export lines (~1043 LOC total):
  - [ ] `components/query-builder/FilterBuilder.tsx` (333 LOC)
  - [ ] `components/query-builder/ColumnSelector.tsx` (291 LOC)
  - [ ] `components/query-builder/GroupByBuilder.tsx` (213 LOC)
  - [ ] `components/query-builder/TableSelector.tsx` (125 LOC)
  - [ ] `components/query-builder/LimitInput.tsx` (44 LOC)
  - [ ] `components/query-builder/SqlPreview.tsx` (37 LOC)
  - The live path (`FilterSection`, `SummarizeSection`, `ColumnsPicker`, `DataSection`, `QueryChip`, pickers) stays.

### 1.2 Dead lib files & exports

- [ ] Delete `lib/sql/enhanced-validator.ts` (72 LOC) + `lib/sql/__tests__/enhanced-validator.test.ts`. (Note: the `normalizeSql` in `sql.test.ts:631` is a separate local function — leave it.)
- [ ] Delete `lib/data/file-queries.ts` (64 LOC; sole export `extractInlineFileQueries`, only importer is its own test) + `lib/data/__tests__/file-queries.test.ts`.
- [ ] Delete `lib/messaging/delivery-options.ts` (only importer: `lib/messaging/__tests__/messaging.test.ts`) + the test coverage for it.
- [ ] Delete export `piStreamEventToLegacy` from `lib/chat-translator/index.ts:479` + its cases in `__tests__/translator.test.ts` (all other translator exports are live — do not touch `piLogToLegacy` / `legacyLogToPi` / `legacyToolResultToPi`).
- [ ] Delete dead pass-through methods `updateNamePath` (`lib/data/files.server.ts:997`) and `renameAndMove` (`:1001`) — pure forwards to DocumentDB, absent from the bound-export list and never called.
- [ ] Delete `atlasSchemaNoViz` from `lib/validation/atlas-json-schemas.ts:98` + its assertions in `__tests__/story-schema.test.ts` and `__tests__/notebook-schema.test.ts` (test-only consumer; confirmed no production consumer). Also delete the corresponding CLAUDE.md mention when M8 runs.
- [ ] **[VERIFY-FIRST]** `lib/auth/guest-rate-limit.ts` — knip flags the whole file unused; no audit agent found an importer. Grep for `guest-rate-limit` including dynamic imports; delete if truly orphaned.
- [ ] **[VERIFY-FIRST]** `agents/benchmark-analyst/v2/auto-context/index.ts` — knip flags it as an unused file (the benchmark CLI may import `auto-context/auto-context.ts` directly). If the barrel is bypassed everywhere, delete the barrel.

### 1.3 Dead Redux store surface

All grep-verified: name appears only on its own definition line.

- [ ] Remove 13 dead selectors: `selectActiveRecordingId`, `selectAllQueryResults`, `selectAskForConfirmation`, `selectDashboardFiles`, `selectFileLoadError`, `selectGettingStartedCollapsed`, `selectHasMetadataChanges`, `selectIsFolderLoaded`, `selectIsRecording`, `selectParamValues`, `selectQuestionFiles`, `selectSidebarDraft`, `selectTopView`.
- [ ] Remove 10 dead action creators: `clearAllResults`, `clearFileEditMode`, `clearProposedQuery`, `clearSidebarDraft`, `setGettingStartedCollapsed`, `setProposedQuery`, `setSidebarDraft`, `toggleDevMode`, `toggleGettingStartedCollapsed`, `toggleRightSidebar`.
- [ ] Remove the three fully-stranded UI-state features (state field + reducer + action + selector, all dead as a unit): **sidebarDraft**, **proposedQuery**, **gettingStartedCollapsed** — all in `store/uiSlice.ts`. (If any is a planned feature, wire it up instead — but decide; don't leave stranded state.)
- [ ] Remove the stub `selectCompanyName = (_state) => undefined` (`store/authSlice.ts:53`) — always returns undefined.
- [ ] Also remove dead slice exports flagged by knip: `clearConfigs` (configsSlice), `clearFiles`, `effectiveName` (filesSlice), `clearJob` (jobRunsSlice), `getQueryHash` re-export (queryResultsSlice) — verify each with grep before removal.

### 1.4 Dead API routes

- [ ] Delete `app/api/dev/render-image/route.ts` — zero refs repo-wide; its docstring claims DevToolsPanel calls it, but `components/DevToolsPanel.tsx:57` only fetches `/api/tools/schema`. (Also an ungated dev endpoint in prod.)
- [ ] Delete `app/api/stream-test/route.ts` — SSE demo, zero refs, ungated.
- [ ] Delete `app/api/health/check/route.ts` — redundant second liveness endpoint; `/api/health` serves that role; zero refs.
- [ ] Delete `app/api/google-sheets/delete/[name]/route.ts` — zero client callers; superseded by `/api/connections/[name]` + `/api/csv/delete-file` (see `components/containers/ConnectionContainerV2.tsx:10,105`).
- [ ] Do **NOT** delete `/api/integrations/slack/oauth-callback-finish` — it looks unreferenced but is reached via a redirect URL built at `app/api/integrations/slack/oauth-callback/route.ts:89`.

### 1.5 Gate (not delete) debug surfaces exposed in prod

Follow the pattern of `app/api/test/faux/route.ts:14` (gate behind `E2E_MODE` / env flag, return 404 otherwise):

- [ ] `app/api/test-error/route.ts` (reachable from `app/settings/page.tsx:429` debug button — gate the route, keep the button dev-only)
- [ ] `app/api/sentry-example-api/route.ts` + `app/sentry-example-page/page.tsx` (Sentry wizard scaffold — gate or delete outright)
- [ ] `app/test-errors/page.tsx`

### 1.6 Unused-export sweep (knip list)

Full scan output archived (128 unused exports + 72 unused exported types). Sweep these by **removing the `export` keyword** (or the symbol, if wholly unused within its file). Each needs a quick grep confirm — knip has known blind spots (NextAuth's `signIn`/`signOut` in `auth.ts`, Playwright fixtures, faux test channels).

Work queue (grouped; skip anything that fails grep-confirm):

- [ ] `lib/chart/chart-utils.ts`: `tooltipAppendTo`, `truncateLabel`, `getNumberScale`, `formatWithScale`, `resolveChartFormats`, `buildToolbox`; `lib/chart/echarts-theme.ts`: `CHART_COLOR_KEYS`, `formatTooltipValue`; `lib/chart/pivot-utils.ts`: `applyAggregation`, `applyOperator`; `render-chart-svg.ts`: `CHART_ASPECT_RATIO`; `render-chart.ts`: `RENDERABLE_CHART_TYPES`
- [ ] `lib/connections/index.ts`: stop re-exporting the connector classes nobody imports via the barrel (`DuckDbConnector`, `CsvConnector`, `PostgresConnector`, `BigQueryConnector`, `AthenaConnector`, `InternalDbConnector`, `SqliteConnector`, `ClickHouseConnector`, `getOrCreateDuckDbInstance`, `resolveDuckDbFilePath`) — everything goes through `getNodeConnector`; `duckdb-stream.ts`: `jsonSafeRow`; `profile-mongo.ts`: `buildSampleQuery`
- [ ] `lib/auth/*`: `access-rules.ts` (`loadAccessRules`, `getCreateLocationRestrictions`, `getCreationBlocklist`, `getDeletionBlocklist`, `canShowInCreateMenu`), `access-rules.client.ts` (`canAccessFileType`, `getCreationBlocklist`, `getDeletionBlocklist`, `canShowInCreateMenu`), `auth-helpers.ts` (`shouldRefreshToken`, `isTokenOutdated`, `getMode`, `getView`, `getServerSession`), `password-utils.ts` (`generateStrongPassword`), `role-helpers.ts` (`getRolePriority`, `hasEqualOrHigherRole`)
- [ ] `lib/data/*`: `configs.server.ts` (`mergePartialConfigs`, `ConfigsAPI`), `connections.server.ts` (`updateConnection`, `testConnection`), `files.ts` (`loadFile`, `loadFiles`, `createFile`, `saveFile`, `getTemplate` — **[VERIFY-FIRST]**, these look like interface members; only remove if genuinely unbound), `helpers/permissions.ts` (4 exports), `helpers/connections.ts` (`DEV_ONLY_CONNECTION_TYPES`), `loaders/index.ts` (`defaultLoader`, `configLoader`, `connectionLoader`, `contextLoader`), `loaders/context-loader-utils.ts` (`findNearestAncestorContext`), `conversation-log.ts` (`COLD_REOPEN_RESUMABLE_TOOLS`), `conversations.server.ts` (`RUN_LEASE_TTL_MS`)
- [ ] `lib/database/*`: `adapter/factory.ts` (`createAdapter`), `config-db.ts` (`getConfigValue`, `setConfigValue`), `duckdb.ts` (`initDuckDB`, `getConnection`), `import-export.ts` (`importToDatabase`), `user-db.ts` (`validateAndNormalizeHomeFolder`), `validation.ts` (4 exports)
- [ ] `lib/api/*`: `api-types.ts` (`ApiError`), `compress-augmented.ts` (`stripQueryResultId`, `computeQueryResultId`), `fetch-wrapper.ts` (`invalidateCache`, `clearCache`), `file-state.server.ts` (`createServerFileState`), `report-client-error.ts` (`reportClientErrorToChat`), `tool-config.ts` (`TOOL_CONFIGS`, `DEFAULT_TOOL_CONFIG`), `tool-handlers.ts` (`registerFrontendTool`)
- [ ] `lib/` misc: `app-event-registry/index.ts` (`AppEventRegistry` class export), `context/schema-bounding.ts`, `conversations-utils.ts` (`slugify`), `csv-processor.ts` (`downloadSpreadsheetAsXlsx`), `csv-utils.ts` (`NAME_PATTERN`), `integrations/slack/config.ts` + `messages.ts`, `jsx/index.ts` (`validateJsx`), `messaging/template-variables.ts`, `mode/mode-utils.ts` (`getModeFromUrl`), `mode/path-resolver.ts` (`getSystemFolders`, `getModeRoot`), `navigation/url-utils.ts`, `object-store/index.ts` (`getMxfoodSeedKey`, `getMxfoodTutorialKey`, adapter class exports), `og/og-cards.tsx` (`GenericCard`), `projection/project.ts` (4 constants), `query-cache/blob-store.ts` + `jsonl.ts`, `recordings.ts` (5 exports), `rubric/*` (4 files), `screenshot/readiness.ts` (`isFileViewBusy`), `sql/schema-filter.ts` (3 exports), `sql/sql-references.ts` (`generateSlug`, `isValidReferenceAlias`), `types.ts` (`isFileReference`), `types/errors.ts`, `ui/file-metadata.ts` + `fileComponents.tsx` + `sidebar-sections.ts`, `utils/attachment-extract.ts` + `database-selector.ts` + `mentions.ts`, `validation/content-validators.server.ts` (`validateFileState`)
- [ ] `agents/` + `orchestrator/`: `analyst/model-config.ts` (`getAnalystModel`), `analyst/skills.ts` (`DEFAULT_PRELOADED_SKILLS`), `micro/model-config.ts` (2), `report/report-agent.ts` (`fauxRegistration`), `skill-content.ts` (`SCHEMA_TEMPLATE_VARS`), benchmark-analyst v2 exports (large batch in `v2/index.ts` — coordinate with M6.2 before touching), `orchestrator/prompts/index.ts` (`HIDDEN_SKILLS`), `orchestrator/llm/testing.ts` (`findResponse`, error classes)
- [ ] `components/`: `RecentFilesSection.tsx` (`FeedContent` + default), `containers/AlertRunContainerV2.tsx` (`AlertRunView`), `explore/message/ExploreWelcome.tsx` (`SuggestedQuestionCard`), `explore/tools/*` (3 constants + `WebSearchDisplay` default), `lexical/LexicalTextEditor.tsx` (3), `plotx/AxisComponents.tsx` (`getTypeIcon`, `getTypeColor`), `plotx/ChartHost.tsx` (`DEFAULT_CHART_SETTINGS`), `query-builder/QueryChip.tsx` (`useChipVariantStyles`), `shared/DeliveryPicker.tsx` (`DeliveryPicker` named dup), `ui/select.tsx` (3), `views/story/ScaledStoryFrame.tsx` (default)
- [ ] Unused exported **types** (72, lower priority — they cost comprehension, not bytes): sweep the list from the archived knip output; biggest cluster is `lib/types.ts` (~60 unused type exports) — fold this into the M3.3 types split rather than doing it twice.
- [ ] Fix the one duplicate export: `agents/analyst/analyst-agent.ts` exports `RemoteAnalystAgent` and `AnalystAgent` as duplicates — keep one canonical name, alias at import sites if needed.
- [ ] Remove unused devDependency `yaml-loader`; add the missing `@lexical/*` packages that are imported but unlisted (rich-text, markdown, list, selection, code, link, table) — currently working via transitive resolution, which is fragile.

**Acceptance for M1:** `npm run validate` + full `npm test` green; `npm run test:e2e` green; knip finding count drops to ~0 (modulo config-registered entries); no runtime behavior change. Commit + push to PR #567.

---

## Milestone 2 — Intra-repo renames: make names stop lying (cheap, high value)

Pure renames + import-path updates. No logic changes. (The `frontend/` → `src/` repo-root rename is deliberately **not** here — see Milestone 7.)

### 2.1 Chat naming (the "v2" lie)

Reality: the live engine is **v3** (`app/api/conversations/[id]/turns/route.ts:85` + `.../stream/route.ts:20` → `lib/chat/conversation-turn.server.ts`). The v2-named file is the shared orchestration core v3 reuses — not dead, just misnamed.

- [ ] Rename `lib/chat-orchestration-v2.server.ts` → `lib/chat/orchestration-core.server.ts` (it provides `setupOrchestration`, `recordLlmCalls`, registries, `estimateNextChatContextV2`).
- [ ] Rename `lib/chat-orchestration.ts` → `lib/chat/chat-types.ts` (verified types-only; every importer uses `import type`).
- [ ] Rename `V2_REGISTRABLES` → `REGISTRABLES` and `V2_HEADLESS_REGISTRABLES` → `HEADLESS_REGISTRABLES` (there is no separate v3 registry; the prefix is purely historical). Update consumers: `app/api/tools/schema/route.ts:5`, `lib/chat/run-orchestration-v2.server.ts`, `lib/chat/run-report-v2.server.ts`, engine call sites.
- [ ] Rename `lib/chat/run-orchestration-v2.server.ts` / `run-report-v2.server.ts` / `run-eval-v2.server.ts` / `run-micro-task.server.ts` consistently (drop `-v2`).
- [ ] Rename `estimateNextChatContextV2` → `estimateNextChatContext`.
- [ ] Fix stale inline comment `agents/analyst/analyst-agent.ts:99` (references deleted `/api/chat/v2` → `shared.ts`).
- [ ] Fix dangling doc pointers in `lib/chat/conversation-turn.server.ts:12` and the stream route citing `docs/chat-architecture-v3.md §7` — the doc lives at repo-root `docs/chat-architecture-v3.md`; make the pointer resolvable from the code location.

### 2.2 Misnamed lib modules

- [ ] `lib/backend/` → `lib/connections/client/` — it contains **browser-side** fetch wrappers (`connection-test.ts`, `csv-upload.ts`, `google-sheets.ts`) used only by connection-form components. "backend" is a fossil of the deleted service.
- [ ] `lib/tests/` → `lib/evals/` — it's a live product feature (user-authored assertions run by job handlers + `app/api/jobs/test/route.ts`), and the current name collides with test infrastructure.
- [ ] `components/test/` → `components/evals/` — production eval-authoring UI (mounted by `context/ContextEditorV2.tsx:19`, `views/AlertView.tsx:193`, `views/TransformationView.tsx:303`), not test helpers.
- [ ] `lib/database/config-db.ts` → `lib/database/config-store.ts` (or `configs-table.ts`) — currently an anagram of the unrelated `db-config.ts`.

**Acceptance for M2:** validate + full test suite + e2e green; `grep -rn "chat-orchestration-v2\|V2_REGISTRABLES\|lib/backend\|lib/tests/" frontend/` (excluding this doc / changelogs) returns nothing. Commit + push to PR #567.

---

## Milestone 3 — Split the grab-bags: `lib/api/` and god files

The deepest structural work. One module per commit. Rule of thumb from the audit: **size alone is not the offense — job-count is** (`sql-to-ir.ts` at 1144 LOC/1 export is fine; `chart-utils.ts` at 2117 LOC/4 jobs is not).

### 3.1 Dissolve `lib/api/` (24 files, 5 unrelated concerns, misleading name)

None of it is the HTTP API surface (that's `app/api/`). Target decomposition:

- [ ] `lib/file-state/` ← `file-state.ts`, `file-state.server.ts`, `file-state-interface.ts`
- [ ] `lib/tools/` ← `tool-handlers.ts`, `tool-config.ts`, `declarations.ts`, `micro-task.ts`, `user-input-exception.ts`
- [ ] `lib/http/` ← `fetch-wrapper.ts`, `fetch-patch.ts`, `useFetch.ts`, `with-auth.ts`, `api-responses.ts`, `api-types.ts`
- [ ] LLM-context transforms (`compress-augmented.ts`, `markup-blocks.ts`, `file-encoding.ts`) → move adjacent to the agent/LLM code (e.g. `lib/chat/` or `agents/` support dir — executor's judgment, but out of `lib/api/`)
- [ ] Remaining misc (`report-client-error.ts`, `unhandled-rejection-logger.ts`, `share-links.ts` [absorbed in M5.2], `llm-calls.ts`, `job-runs-state.ts`, `execute-query.server.ts`) → nearest cohesive home (`lib/messaging/`, `lib/jobs/`, `lib/query-cache/`… case by case)
- [ ] Update the ESLint rules / CLAUDE.md guidance that reference `lib/api/api-responses.ts` (`handleApiError` path) after the move.

### 3.2 Split god files (each keeps a single entry point; helpers move behind it)

- [ ] `lib/chart/chart-utils.ts` (2117 LOC, 22 importers, 4 jobs) →
  - `chart-format.ts` (value/number/date formatting: `formatLargeNumber`, `getNumberScale`, `formatWithScale`, `formatNumber`, `applyPrefixSuffix`, `formatDateValue`, `DATE_FORMAT_OPTIONS`, `truncateLabel`, `buildCompactYLabel` — lines ~59-453)
  - `chart-annotations.ts` (`buildAnnotationGraphics` ~:1086, `resolveAnnotationX/Y`, `resolveXAxisTypes`, `findMatchingXIndex` ~:146-344)
  - `chart-builders/{pie,funnel,waterfall,radar}.ts` (`buildPieChartOption` :492, `buildFunnelChartOption` :672, `buildWaterfallChartOption` :799, `buildRadarChartOption` :951)
  - `chart-utils.ts` keeps `buildChartOption` (:1472) + `ChartProps` as the entry point
- [ ] `lib/api/file-state.ts` (1827 LOC, ~40 exports) → within the new `lib/file-state/`: `file-read.ts` (loadFiles/readFiles/readFolder), `file-edit.ts` (the 5 edit variants), `file-publish.ts` (publishFile/publishAll), `file-mutations.ts` (delete/move/batchMove/drafts/folders), `query-results.ts` (getQueryResult + semaphore), `notebook-results.ts` (captureNotebookCellResult/rehydrateNotebookResults :386-468). Keep a barrel so `lib/hooks/file-state-hooks.ts` imports stay stable.
- [ ] `lib/api/tool-handlers.ts` (1221 LOC) → registry + `handlers/<tool>.ts` files, keyed by the registry; keep `executeToolCall` as the single entry.
- [ ] `lib/types.ts` (1383 LOC, 100+ exports, **385 importers**) → split into domain modules (`types/files.ts`, `types/alerts.ts`, `types/reports.ts`, `types/jobs.ts`, `types/context.ts`, `types/connections.ts`) with `lib/types.ts` remaining as a thin re-export barrel so the 385 importers don't churn. It already delegates to `./ui/file-metadata` and `./sql/ir-types` — extend that pattern. Fold in the ~60 unused-type deletions from M1.6 here. **High risk — 385 importers.** Do this incrementally (one domain module at a time), running the full suite between each extraction, not as one giant cut.
- [ ] `lib/sql/schema-filter.ts` (669 LOC, 19 importers, 3 unrelated concerns) → keep whitelist filtering under the (now accurate) name (`filterSchemaByWhitelist*`, `applyWhitelistToConnections`, `getWhitelistedSchemaForUser` :141-319); extract `lib/sql/context-docs.ts` (:400-663: `getDocumentationForUser`, `resolveContextDocs`, `clampDocContent`, `inlineContextDocsText`, `loadContextDocsByKeys`, `formatContextDocsSection`) and `lib/sql/annotation-notes.ts` (:24-140: `budgetAnnotationNotes`, `backfillAnnotationConnections`).
- [ ] `agents/benchmark-analyst/v2/auto-context/auto-context.ts` (1171 LOC) → split by phase (catalog render / generation / cache). Coordinate with M6.2 (v1 benchmark retirement) so effort isn't wasted.
- [ ] Optional/low priority: `lib/chart/geo-*` (5 files) → `lib/chart/geo/`; `statistics-engine.ts` per-dialect profilers → `profilers/` subfolder (only if it grows — currently cohesive, KEEP otherwise).

**Acceptance for M3:** validate + full tests green after each extraction (not just at the end of the milestone); no import cycles introduced (`npm run lint` catches the inline-import workaround smell); public entry points unchanged for consumers (barrels preserved where importer count is high). Commit + push to PR #567 per completed sub-item, not just at milestone end — this is the highest-risk milestone in the plan.

---

## Milestone 4 — UI plane: taxonomy, discipline, god components

### 4.1 `components/` root taxonomy (70 root files, ~20.6k LOC — none dead, all misfiled)

Move-only changes (plus import updates). Proposed buckets:

- [ ] `components/file-browser/` ← `FileView`, `FilesList`, `FolderView`, `FileHeader`, `FileLayout`, `FileActionMenu`, `FileSearchBar`, `FileTypeBadge`, `FileNotFound`, `FileHealthPanel`, `HomeFolderFiles`, `RecentFilesSection`, `Breadcrumb`, `InfiniteScrollSentinel`, `ViewStack`
- [ ] `components/app-shell/` ← `Providers`, `ReduxProvider`, `AuthProvider`, `AnalyticsProvider`, `ColorModeSync`, `NavigationSync`, `LayoutWrapper`, `DataLoader`, `ErrorHandler`, `Sidebar`, `RightSidebar`, `MobileRightSidebar`, `MobileBottomNav`, `MobileHamburgerMenu`, `MobileNewFileSheet`, `FloatingChatWrapper`
- [ ] `components/selectors/` ← `DatabaseSelector`, `GenericSelector`, `ImpersonationSelector`, `ChildPathSelector`, `DatePicker`, `TabSwitcher`
- [ ] `components/banners/` ← `DataPrepBanner`, `DemoModeBanner`, `UpdateBanner`, `DashboardUsageBadge`
- [ ] `components/modals/` (exists) ← `SaveFileModal`, `PublishModal`, `MoveFileModal`, `BulkMoveFileModal`, `NewFolderModal`
- [ ] `components/dev/` ← `DevToolsPanel`, `AppStateViewer`, `JsonViewer`, `SessionPlayer`, `RecordingControl`
- [ ] `components/params/` ← `ParameterInput` (901 LOC), `ParameterRow`
- [ ] Remaining root files: place case-by-case; goal is ≤10 files left at root.
- [ ] Consolidate the two lexical dirs: `components/lexical/` + `components/chat/lexical/` (`MentionsPlugin.tsx` 801 LOC) → one module.

### 4.2 Container/View discipline (or retire the convention honestly)

14 `views/` files dispatch Redux / read `state.files` directly while their `containers/*V2` wrappers stay thin. Worst: `views/QuestionViewV2.tsx` (13 Redux touchpoints — `dispatch(setFile)` :229, `addReferenceToQuestion` :424, `removeReferenceFromQuestion` :434, reads `state.files.files` :195) and `views/DashboardView.tsx` (16 — `addQuestionToDashboard` :569, `pushView` :436, `setEphemeral` :507, reads :205).

- [ ] **Decide first**: either (a) enforce the convention — move Redux access up into the containers, views take props/callbacks; or (b) officially retire the container/view split and merge the thin containers down. Pick ONE; don't half-do both. Default (in the absence of the owner): (a) for the two worst offenders, pragmatic tolerance for feature-module views elsewhere — this preserves the existing documented convention rather than deleting it, and is the lower-risk default when the owner isn't reachable to confirm a convention change.
- [ ] **This is a rearchitecture of live, user-facing view components with thin test coverage in places.** Before touching `QuestionViewV2`/`DashboardView`: confirm existing `*.ui.test.tsx` / e2e coverage actually exercises the Redux-dispatching code paths being moved (Blue→Red→Blue: break the dispatch, confirm a test goes red). If coverage is too thin to safely prove behavior preservation, do NOT force the move — document it as blocked in this checklist with what coverage is missing, rather than shipping an unverified change to the two most-used view components in the app.
- [ ] Apply the decision to: `QuestionViewV2`, `DashboardView` (mandatory if coverage supports it), then `ConnectionFormV2`, `TransformationView`, `AlertView`, `ReportView`, `NotebookView`, `CodeView`, `StoryView`, `AgentHtml`, `InlineNumber` as capacity/coverage allows.
- [ ] Update CLAUDE.md's Component Patterns section to state the decided rule (do this in M8, alongside the rest of the docs pass).

### 4.3 God components (32 files >600 LOC; split the worst)

Each split: container/view or sub-component extraction; behavior-preserving; use existing `*.ui.test.tsx` coverage as the red/green harness (per repo TDD rule: prove tests guard behavior before refactoring — Blue→Red→Blue). Same rule as 4.2: if a component's test coverage can't prove the split is behavior-preserving, document as blocked rather than force it.

- [ ] `components/context/ContextEditorV2.tsx` (1503) — editor + tests-panel + docs concerns
- [ ] `components/explore/ChatInterface.tsx` (1493) — the chat god component
- [ ] `components/views/ConnectionFormV2.tsx` (1413) — the 9 config branches already live in `connection-configs/`; reduce to dispatch glue
- [ ] `components/views/connection-configs/StaticConnectionConfig.tsx` (1255)
- [ ] `components/plotx/PivotTable.tsx` (1238) and `plotx/TableV2.tsx` (1006)
- [ ] `components/SchemaTreeView.tsx` (1080), `FilesList.tsx` (1037), `views/QuestionViewV2.tsx` (986 — combine with 4.2), `query-builder/SummarizeSection.tsx` (956), `DataManagementSection.tsx` (949), `RecentFilesSection.tsx` (936), `SqlEditor.tsx` (916), `ParameterInput.tsx` (901), `explore/AgentTurnContainer.tsx` (878), `connection-wizard/steps/StepContext.tsx` (837), `PublishModal.tsx` (812), `chat/lexical/MentionsPlugin.tsx` (801)

**Acceptance for M4:** validate + `npm run test:ui` + `npm run test:e2e` + `npm run test:qa` green; no view file imports `useDispatch`/`useSelector` if option (a) chosen (add an ESLint rule scoped to `components/views/**` to lock it in). Commit + push to PR #567 per sub-section (4.1, then 4.2, then 4.3) — don't batch the whole milestone into one push, since 4.2/4.3 are the riskiest behavioral changes in the entire plan.

---

## Milestone 5 — Boundary enforcement & duplication lifts

### 5.1 DocumentDB boundary (decide + enforce)

CLAUDE.md says DocumentDB may only be used inside the server FilesAPI, but three sibling modules import `@/lib/database/documents-db` directly: `lib/data/connections.server.ts:10`, `lib/data/configs.server.ts:2`, `lib/data/heal-stories.server.ts:8`.

- [ ] **Decide**: (a) funnel all three through FilesAPI, or (b) bless DocumentDB as the shared server-side data primitive for `lib/data/*` server modules and update the CLAUDE.md rule to match. Default (in the absence of the owner): (b) — these are all server-only `lib/data/*` siblings of `files.server.ts` doing legitimate direct data access for non-file-shaped concerns (connections, configs, one-shot healing), not a boundary violation from outside the data layer. Blessing this is lower-risk than restructuring three working modules through an interface not designed for their shapes.
- [ ] Enforce with an ESLint `no-restricted-imports` rule scoped to everything outside the blessed files.

### 5.2 Shares modeled twice → one `SharesAPI`

Server FilesAPI carries `resolveShare`/`getShares`/`addShare`/`revokeShare`/`setStoryPreview` (`files.server.ts:1040-1089`) that are absent from `IFilesDataLayer` and unmirrored on the client; the client side is a separate raw-fetch module `lib/api/share-links.ts:21-35`.

- [ ] Extract a dedicated `SharesAPI` with client+server implementations behind one interface (follow the `lib/data/completions/` pattern, which does this correctly).
- [ ] Delete `lib/api/share-links.ts` once absorbed; remove the share methods from the FilesAPI server bulge.

### 5.3 Raw `fetch('/api/files…')` bypasses → FilesAPI

- [ ] `components/QuestionSchemaSection.tsx:54` (`/api/files/batch`) → `FilesAPI.loadFiles`
- [ ] `components/containers/TransformationContainerV2.tsx:51` (`/api/files/:id?refresh`) → `FilesAPI.loadFile`
- [ ] `lib/api/file-state.ts:998` raw fetch → route through the client FilesAPI
- [ ] Add a FilesAPI method for rubric fetch; migrate `components/FileHealthPanel.tsx:138` and `lib/api/tool-handlers.ts:531`
- [ ] Add a FilesAPI/SharesAPI method for preview; migrate `lib/og/capture-story-preview.ts:34`

### 5.4 Connector duplication → lift into `lib/connections/base.ts`

- [ ] Extract `rewriteNamedParams(sql, params, mapFn)` owning the grammar + `::cast` lookbehind (currently copy-pasted at `clickhouse-connector.ts:29`, `bigquery-connector.ts:136` & `:190`, `athena-connector.ts:89` & `:139`, `named-to-positional.ts:25`; the bug-history knowledge lives only in `named-to-positional.ts:6-11`). Connectors pass only a replacement mapper.
- [ ] Make `NodeConnector.testConnection` a concrete template method calling a new abstract `ping()`; delete the 8 near-identical implementations (`postgres`, `clickhouse`, `athena`, `bigquery`, `csv`, `duckdb`, `mongo`, `sqlite` connectors — each repeats the try/catch + `includeSchema` branch + `'Connection successful'` shape).
- [ ] Extract `groupColumnsIntoSchemaEntries(rows, keyFns)` (near-identical reduces at `postgres-connector.ts:124-142`, `clickhouse-connector.ts:165-177`, re-grouped again in `statistics-engine.ts:104-108`).
- [ ] Collapse the two disagreeing `connectionTypeToDialect` functions (`lib/types.ts:1360` vs `lib/utils/connection-dialect.ts:4` — they differ on Athena; `ADDING_A_CONNECTOR.md:152-155` documents the disagreement) into one source of truth; delete the other.
- [ ] Document (or promote to the public surface) the one sanctioned internals bypass: `agents/benchmark-analyst/shared-duckdb.ts:23-26` imports DuckDB connector internals directly — acceptable for the eval harness, but mark it intentional.

### 5.5 Fat routes → extract business logic to lib/

- [ ] `app/api/integrations/slack/events/route.ts` (362 LOC): move `processSlackEvent` (lines 69–267) into `lib/integrations/slack/`.
- [ ] `app/api/jobs/cron/route.ts` (298): move the hand-rolled cron parser (`matchesCronField`/`isCronDue`/`getPrevFireTime`, lines 35–98) + `runForOrg` into `lib/jobs/` (a `getCron` concept already exists in `lib/jobs/job-definitions.ts` — unify).
- [ ] `app/api/jobs/run/route.ts` (237): move job-run orchestration + the delivery-dispatch block (email/phone/slack, lines 135–208) into `lib/jobs/`, reusing `lib/messaging`.
- [ ] `app/api/query/route.ts` (176): move `whitelistToSchemaContext` helper into `lib/sql/`.
- [ ] Unify or dev-namespace the **shadow tool registry**: `app/api/chat/orchestrator.ts` + `app/api/chat/tool-handlers.server.ts` re-declare `SearchDBSchema`/`ExecuteQuery`/`FuzzyMatch`/`SearchFiles`/`LoadSkill`/`Clarify` solely for the dev Tool Inspector (`app/api/tools/execute/route.ts:5` ← `components/explore/ToolInspectModal.tsx:157`). Either back it with the real `REGISTRABLES` or move it under a clearly-dev path and gate it.

### 5.6 Small colocations (low priority, batch into one commit)

- [ ] Move single-consumer `lib/utils/*` helpers to their sole caller: `deep-merge` + `promise-manager` → `lib/file-state/`; `error-parser` → `components/question/QuestionVisualization.tsx`'s module; `internal-link` → Markdown module; `id-generator` + `tool-watchdog` → `store/chatListener.ts`'s module. Keep the genuinely shared ones (`immutable-collections`, `query-hash`, `database-selector`, `xml-parser`, `attachment-extract`).
- [ ] Fold `lib/markdown/` (2 files, sole consumer `components/Markdown.tsx`) into a `components/Markdown/` module.
- [ ] Move `orchestrator/test-spec-runner.ts` (201 LOC, imported only by tests) out of the production `orchestrator/` tree into a test-support dir.
- [ ] Relocate story/markup transformation cluster out of `lib/data/` into `lib/data/story/` (or `lib/story/`): `story-number.ts`, `story-params.ts`, `story-question.ts`, `story-v2.ts`, `content-jsx.ts`, `file-markup.ts`, `html-attr.ts`, `file-title.ts`, `template-defaults.ts` — these are HTML↔content conversion, not data access.
- [ ] Relocate maintenance one-shots out of `lib/data/`: `heal-stories.server.ts` (+ its script) and `migrate-conversations-v3.server.ts` → `lib/data/migrations/` (pending M6.1 deletion decision — don't move what you're about to delete).

**Acceptance for M5:** validate + full tests green. Commit + push to PR #567.

---

## Milestone 6 — Conditional deletions (verify state-of-the-world first)

These require information no grep can supply (prod DB state, team roadmap decisions). Attempt best-effort verification via available code-level signals; where certainty isn't achievable without the owner, **skip the deletion and document exactly what's unverifiable** — do not delete migration or fallback code on a guess. This is the same discipline as the thin-test-coverage gate in M4: correctness over completeness.

### 6.1 v2→v3 conversation migration one-shots **[VERIFY-FIRST: prod backfill complete]**

- [ ] Best-effort verification path (no prod DB access available): check whether the codebase itself has dropped all v2-conversation-log read paths elsewhere (i.e. is `legacyLogToPi` only reachable from `session-logger.ts` and the migration script, with nothing in the live request path still branching on "not yet migrated"?). If the live conversation read/write path (`lib/chat/conversation-turn.server.ts` and friends) has **zero** conditional branching on conversation schema version, that's reasonably strong evidence the migration is assumed complete throughout the app already (i.e. deleting the *migration tool* changes nothing about whether unmigrated orgs work — they're already unsupported by the live path, migrated or not). If that holds, proceed with deletion; if any live path still branches on schema version, stop and document — that's a sign migration completeness is NOT yet safe to assume.
- [ ] If verified: delete `lib/data/migrate-conversations-v3.server.ts`, `scripts/migrate-conversations-to-v3.ts`, `app/api/admin/migrate-conversations-v3/route.ts`, and the `legacyLogToPi` usages that exist only for this path (keep `legacyLogToPi` itself if `lib/mcp/session-logger.ts` still needs it — it does today).
- [ ] If not verifiable: leave in place, note in this checklist exactly what couldn't be confirmed (e.g. "N orgs found with pre-v3 schema markers in local/dev DB — cannot check prod").

### 6.2 v1 benchmark path **[VERIFY-FIRST: DAB_V2 is the permanent default]**

- [ ] Best-effort verification: check `lib/config.ts` for the `DAB_V2` default value and whether any CI/CD or npm script still runs without `DAB_V2` set (i.e., does the *default* config value already assume v2, making v1 unreachable in practice?). Check git blame / commit history on `DAB_V2` for signals it was a temporary rollout flag now past its rollout window.
- [ ] If verified (default is v2, no script exercises v1, and it's not a recent/active flag): delete the v1 chain: `agents/benchmark-analyst/explore-dataset.ts` (280 LOC), v1 `agents/benchmark-analyst/db-tools.ts` (944), `shared-duckdb.ts` (557 — verify v2 doesn't use it first), v1 `double-check-benchmark.ts`, `submit-answer.ts`, and the `DAB_V2` flag branch in `benchmarks/dataanalystbench.ts` + related `DAB_*` env vars in `lib/config.ts` (knip flags 11 unused `DAB_*` config exports). Remove the v1 entries from the resume registrables.
- [ ] If not verifiable: leave in place, document why (e.g. "DAB_V2 defaults false" or "flag was set 2 weeks ago, too recent to assume permanent").

### 6.3 Legacy import format **[VERIFY-FIRST: no live exporter emits it]**

- [ ] Grep every producer of `InitData`/export payloads (`lib/database/import-export.ts` exporters, any admin/backup tooling) for whether any current code path constructs the nested `orgs`/`companies` shape. If zero producers remain (only the `@deprecated`-marked *importer* branch reads it, nothing writes it), this is a safe, fully-code-verifiable deletion — no prod access needed, this one doesn't actually require owner sign-off if the grep is clean.
- [ ] If verified clean: prune from `lib/database/import-export.ts`: `OrgData` (:25, `@deprecated`), `InitData.orgs`/`InitData.companies` (:51-53), the `resolveFlatData` legacy branch (:124-133).
- [ ] If any producer still exists: document it and leave in place.

**Acceptance for M6:** every item above ends in either "deleted, with the verification evidence recorded in this checklist" or "kept, with the specific blocker recorded." No silent skips. Commit + push to PR #567.

---

## Milestone 7 — Repo rename: `frontend/` → `src/` (last content change)

Do this **after** M1–M6 are complete and green, and **before** M8 (docs), so the docs milestone describes the true final layout instead of a structure that then moves again. Pure mechanical path churn — no logic changes — but repo-wide, so do it in one clean pass rather than interleaved with other work.

`frontend/` contains the entire product (UI + in-process orchestrator + connectors + document DB) — the separate backend it was named against no longer exists. Rename the directory; **keep the published Docker image names**.

- [ ] `git mv frontend src` + update all path references:
  - [ ] `.github/workflows/test.yml`, `qa.yml`, `e2e.yml`, `publish.yml`
  - [ ] `docker-compose.yml` + `docker-compose.prod.yml` (the `./frontend/.env` env_file mount)
  - [ ] `src/Dockerfile` build context references
  - [ ] Repo docs: `README.md`, `LOCAL_DEV.md`, `CLAUDE.md`, `docs/`, root `scripts/` (leave the CLAUDE.md content rewrite itself to M8 — just fix the `frontend/` path references here so M8 isn't also chasing a stale directory name)
- [ ] **Do NOT rename** `ghcr.io/minusxai/minusx-frontend[-canary]` images — `install.sh` on self-hosted machines pulls them by name. (Optionally publish under a second name later and dual-publish for a deprecation window.)
- [ ] **Companion change in the separate `~/projects/deploys` repo** (confirmed local, no need to guess at its contents): `deploys/.github/workflows/qa.yml` checks out `minusxai/minusx` fresh and runs everything with `working-directory: ./frontend` (7 occurrences: Node cache path, node_modules cache key + path, `npm ci`, Playwright version resolution, Playwright install, `npm run test:qa`, report upload path). This workflow **will break** the next time it's dispatched unless these 7 paths are updated to `./src`. Prepare this as a **separate small PR against `minusxai/deploys`** (not part of PR #567, since it's a different repo) — open it, but per the same "don't merge without review" policy, do not merge it either. Note in both PR descriptions that they must land together.
- [ ] Self-hosters who `git pull` will have an orphaned `frontend/.env`: update `install.sh`/upgrade path to move it, or keep a compat symlink for one release and document in release notes.

**Acceptance for M7:** validate + full test suite + e2e + qa green with the new `src/` layout; `grep -rln "frontend" --include="*.yml" --include="*.yaml" .github/ docker-compose*.yml` (in `minusx`) returns nothing except the intentionally-kept Docker image name strings; the companion `deploys` PR is opened (unmerged) and cross-referenced. Commit + push to PR #567.

---

## Milestone 8 — Documentation reconciliation (describes the final, post-rename state)

`docs/DOCS_SYNC.md` says docs were last reconciled at `684d9ca5` (2026-06-03) — well over a hundred commits behind at audit time, and further behind still after M1–M7. Do this milestone **last**, against the final `src/` layout, so it isn't immediately stale again.

- [ ] Rewrite the CLAUDE.md chat section: the claimed entry points `app/api/chat/route.ts` and `app/api/chat/stream/route.ts` **do not exist**. Document the actual v3 flow: `POST /api/conversations/[id]/turns` (fires `runConversationTurn` detached) + `GET /api/conversations/[id]/stream` (resumable SSE via Postgres LISTEN/NOTIFY) → `lib/chat/conversation-turn.server.ts` → orchestration core. Include the run-lease/auto-retry model and the conversations tables.
- [ ] Update every CLAUDE.md mention of `lib/chat-orchestration-v2.server.ts` / `V2_REGISTRABLES` to the M2 names.
- [ ] Remove the `atlasSchemaNoViz` mention from CLAUDE.md (deleted in M1).
- [ ] Reflect all M2–M7 renames (`lib/evals/`, `lib/connections/client/`, `components/evals/`, `src/`) throughout CLAUDE.md / README / LOCAL_DEV / docs site.
- [ ] Write up the M4.2 container/view decision (whichever was actually applied) and the M5.1 DocumentDB boundary decision in CLAUDE.md, replacing the old prescriptive text with what's actually enforced.
- [ ] Bump `docs/DOCS_SYNC.md` to the reconciliation commit.

**Acceptance for M8:** a fresh reader of CLAUDE.md would correctly predict where every major code path lives, with zero references to nonexistent files. Commit + push to PR #567.

---

## Final validation

- [ ] Full clean-room check: `npm run validate && npm test && npm run build && npm run test:e2e && npm run test:qa` — all green, run right before the final push (not just per-milestone; `build` in particular is never exercised mid-milestone above and needs at least one full pass at the end since Next.js route/server-boundary breaks don't surface at `validate`).
- [ ] Manually browser-verify the golden paths per CLAUDE.md's TDD workflow (step 6): open a question, edit + run a query, open a dashboard, open the side-chat, send a message, and expand the debug message to confirm the exact LLM request/response — don't assume the refactor left chat intact, check it.
- [ ] `npm run knip` clean against the M0 config (or every remaining finding individually justified in this doc).
- [ ] Push final state to PR #567; confirm all GitHub Actions checks (`test.yml`, `qa.yml`, `e2e.yml`, `publish.yml` build step) are green on the PR. **Do not merge.**
- [ ] Open (don't merge) the companion `~/projects/deploys` PR fixing `qa.yml`'s `./frontend` → `./src` paths; link it from PR #567.
- [ ] Write a final summary comment/section in this doc: what was completed, what was explicitly skipped with reasons (expected: some/all of M6's conditional deletions, possibly parts of M4.2/M4.3 if test coverage was too thin), and what decisions were made at the two owner-decision points (M4.2 container/view, M5.1 DocumentDB boundary) with rationale.

---

## Completion checklist

- [ ] All milestones (0–8) complete or explicitly annotated as blocked with a reason; `npm run knip` ≈ clean against the M0 config
- [ ] CLAUDE.md, README, LOCAL_DEV, docs/ consistent with the new layout; `docs/DOCS_SYNC.md` bumped
- [ ] ESLint guards added for the newly-decided boundaries (views↛Redux if M4.2(a) chosen; DocumentDB rule per M5.1)
- [ ] `frontend/` no longer exists; CI, Docker, install path all green on `src/`; companion `deploys` PR opened and linked
- [ ] PR #567 has every CI check green; **not merged** (per owner instruction — leave for manual review)
- [ ] This file updated: check every box or annotate why an item was rejected (rejections are fine; silent skips are not)
