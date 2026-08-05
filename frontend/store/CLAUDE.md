# Client state — Redux, file-state, hooks, navigation

The browser's source of truth: the Redux store and its two listener middlewares, every browser-side
file and query operation (`lib/file-state`), the React surface over them (`lib/hooks`), and the
routing/guard layer (`lib/navigation`). Those three `lib/` directories have no doc of their own —
`lib/file-state` and `lib/hooks` carry pointer stubs back to this file, `lib/navigation` carries
nothing at all.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## What each module owns

**`store/`** owns the shape of client state and the *reactions* to it. `store/store.ts` composes ten reducers (`auth`, `ui`, `files`, `queryResults`, `configs`, `chat`, `recordings`, `jobRuns`, `navigation`, `users`) plus three middlewares — `navigationListenerMiddleware` and `chatListenerMiddleware` prepended, `analyticsMiddleware` (`lib/analytics/middleware.ts`) concatenated. It exports a per-request store on the server and a module singleton in the browser; `getStore()` is the non-React accessor that `lib/file-state/*` and tool handlers use.

It does **not** own network calls. No slice fetches anything: every reducer is a pure state transition, and all I/O lives in `lib/file-state/`, `lib/data/*`, or the two listeners.

- `filesSlice.ts` — the file cache and the change-tracking model (`content` / `persistableChanges` / `ephemeralChanges` / `metadataChanges`, plus `pathIndex` path→id). It also holds dirty-file classification (`selectDirtyFiles`, `selectSaveClassification`) and a path→context resolver (`selectContextFromPath`).
- `queryResultsSlice.ts` — query results keyed by `getQueryHash(query, params, database)` (`lib/utils/query-hash.ts`), capped at `MAX_CACHED_RESULTS = 256` with newest-first LRU eviction.
- `chatSlice.ts` — one `Conversation` record per id: messages, `pending_tool_calls`, ephemeral streaming buffers, the queued-message list, fork links, and the `remoteSession` flag.
- `chatListener.ts` — the engine of chat: it runs v3 turns, executes frontend-bridged tools, observes remote agent sessions, flushes the message queue, and re-renders from the durable log.
- `uiSlice.ts` — everything view-local and mostly localStorage-mirrored (sidebars, colour mode, dev mode, per-file edit/view mode, the question view stack, chat attachments).
- `appStateSelector.ts` — derives the `AppState` blob sent to the LLM from `navigation` + `files` + `queryResults` + `ui.viewStack`. It exists as its own file purely to break the cycle `navigationSlice → file-state → store → navigationSlice`.
- `conversation-log-cache.ts`, `conversation-stream-client.ts`, `tool-watchdog.ts`, `color-mode-override.ts` — chat transport and plumbing, covered under "Chat path" and "Gotchas".
- `api-url.ts` — `API_BASE_URL` (`http://localhost:3000` under Node, `''` in the browser) plus `patchApiUrl`, which re-appends `as_user`/`mode` by hand. It exists because the SSE client uses XHR, which **bypasses the global fetch patch** that normally forwards those params; drop it and a stream request silently loses its mode.
- `id-generator.ts` — `generateUniqueId()`, the `mxgen_`-prefixed hex tool-call id, shared by client and server.

**`lib/file-state/`** owns every file and query operation in the browser. `file-state.ts` is a pure barrel; the implementation is split by verb: `file-read.ts` (`loadFiles`, `loadFileByPath`, `readFiles`, `readFilesByCriteria`, `readFolder`), `file-edit.ts` (`editFile`, `editFileStr`, `replaceFileState`, `applyJsonContentEdit`, `applyMarkupContentEdit`, `applyStoryHtmlEdit`, `buildCurrentFileStr`), `file-publish.ts` (`publishFile`, `publishAll`), `file-mutations.ts` (delete/move/reload/discard/draft-create/duplicate/dry-run/create-folder), `query-results.ts` (`getQueryResult`), `notebook-results.ts` (per-cell result capture and rehydration), `shared.ts` (`hashString`, `deepMerge`, `generateDiff`, `PromiseManager`).

It does **not** own the HTTP layer — every call goes through `FilesAPI` (`lib/data/files.ts`) or a bare `fetch` to `/api/query`; it does not own augmentation (`selectAugmentedFiles` in `lib/store/file-selectors.ts` is a pure Redux selector); and it does not own permissions beyond the client-side display filter in `readFolder`.

`file-state.server.ts` is the server twin (`readFilesServer`, `getAppStateServer`) for tool handlers and cron jobs: it reads through `FilesAPI` from `lib/data/files.server.ts`, takes an explicit `EffectiveUser`, and touches no Redux. `file-state-interface.ts` holds the option/result types both sides share.

**`lib/hooks/`** owns the React surface. `file-state-hooks.ts` is the CORE set (`useFile`, `useFilesByCriteria`, `useFileByPath`, `useFolder`, `useQueryResult`, `useAppState`, `useDirtyFiles`, `useSaveDecision`). Every one is the same two-part shape: an effect that calls the imperative `lib/file-state` function, plus a `useAppSelector` with a custom equality function so it re-renders only on a real change. Domain hooks (`useConnections`, `useContext`, `useContexts`, `useConversation`, `useConversationsList`, `useConfigs`, `useUsers`, `useExplainQuestion`, `job-runs-hooks`, and the recording pair `useRecordingManager`/`useRecordingContext`) compose those or their own `lib/data` clients; the leaf utilities (`use-deep-stable`, `use-stable-callback`, `use-table-columns`, `use-story-preview-css`, `use-story-rebuild-stability`, `use-semantic-compat`, `use-semantic-models`, `use-spreadsheet-result`, `useScreenshot`, `use-prehydrated-value`) are render-identity, layout-stability and lazy-fetch helpers with no Redux writes.

`use-prehydrated-value.ts` guards a server-rendered, `autofocus`ed form field. Such a field is typeable — and fillable by a password manager — as soon as it paints, which is before the bundle hydrates. React preserves that text through hydration itself (`initInput` skips the value write while `isHydrating`), but the `useState` behind the controlled input is still `''`, so the first render after hydration reaches `updateInput`, sees `props.value !== element.value`, and blanks the field. Attaching the returned ref makes the mount effect adopt the live DOM value into state, so the controlled value agrees with what the user sees. `app/login/page.tsx` is the caller that makes it necessary: the login form only reaches the browser as real HTML because that page reads its query params server-side instead of with `useSearchParams()` (see `frontend/app/CLAUDE.md`).

**`lib/navigation/`** owns URL-parameter preservation (`url-utils.ts`: `as_user`, `mode`, `view` — defaults `org`/`full` are deliberately not written back into URLs), the patched router (`use-navigation.ts`), the unsaved-changes/agent-running interception (`NavigationGuardProvider.tsx`), the navigation-churn queue (`nav-progress.ts`), and the document-surface link bridge (`surface-link-bridge.ts`). It does **not** own route→data loading; that is `store/navigationListener.ts`.

`surface-link-bridge.ts` exists because a story/dashboard surface mounts a **nested React root inside its iframe**, and React context does not cross roots: `next/link` in there sees a null router, returns from its click handler without `preventDefault()`, and the browser performs the anchor's default navigation — which `<base target="_top">` turns into a full document load that resets Redux (losing, among other things, an unsent side-chat draft). `bridgeSurfaceLinks(doc, navigate)` puts one delegated click listener on the iframe document and routes same-origin anchors through the parent tree's router; `components/views/shared/DashboardSurface.tsx` and `AgentHtml.tsx` each install one. It is also the only place that can restore `mode`/`as_user`/`view` on those links, since `components/ui/Link.tsx` reads them from `useSearchParams()`, which is equally contextless inside the surface and silently yields none. Cross-origin, `target`, `download` and modified clicks are declined and keep the `_top` fallback.

## Architecture

**Read path.**

```
component → useFile(id) ──effect──▶ loadFiles([id], ttl, skip)
                │                        │
                │                        ├ filter: id > 0, not fresh, not skipped
                │                        ├ PromiseManager dedupe (key = sorted ids)
                │                        ├ FilesAPI.loadFiles → dispatch setFiles
                │                        └ post-pass: missing ids → setLoadError NOT_FOUND
                └──selector──▶ selectAugmentedFiles(state, [id])
                                 = { fileState, references, queryResults }
```

`loadFiles` never throws; every failure lands in `file.loadError`. `readFiles` layers optional query execution on top (`runQueries: true`): for the root file and each already-`buildEffectiveReference`'d reference it resolves an execution via `getQuestionExecution` and calls `getQueryResult`, all under `Promise.allSettled` so one broken query can't fail the read.

**Write path.** Edits are staged in Redux and only persisted by an explicit publish.

```
editFile / editFileStr / applyJsonContentEdit
      ↓ setEdit (merge) | setFullContent (replace, sets contentReplaced)
  files[id].persistableChanges          ← selectIsDirty / selectDirtyFiles see this
      ↓ publishFile(id)  or  publishAll([ids])
  persistableContentOf(file) → FilesAPI.saveFile / batchSaveFiles (expectedVersion)
      ↓ setFile(updatedFile) + clearEdits + clearMetadataEdits
```

`publishAll` expands the requested ids to include their dirty references (via `extractReferencesFromContent`), sends one batch, then resolves any per-file `conflicts` by re-running `publishFile` on each — which is where the 409 overlay logic lives (take the server's `name`/`path`, overlay only the local `persistableChanges` on the server's content, retry at the server's version). `store/__tests__/staleSaveBugE2E.test.ts` pins this whole chain.

**Query path.**

```
useQueryResult(query, params, db)
  → noneifyEmptyNumericParams (ONCE, so effect key == selector key)
  → getQueryResult(...)
      1. selectIsQueryFresh? → return cached data, or re-throw a cached error
      2. queryPromiseManager.execute(queryHash, …)   ← dedupe
      3. dispatch setQueryLoading  (BEFORE the semaphore, so queued cards show "loading")
      4. querySemaphore.run(…)     ← limit is a getter reading selectMaxConcurrentQueries
      5. fetch /api/query, AbortController = timeout ⊕ caller's signal
      6. decodeJsonl(body) + X-Cached-At → runOrDefer(dispatch setQueryResult)
```

**Chat path.** `chatListener.ts` is the only driver.

```
dispatch(createConversation | sendMessage | retryConversationTurn | editAndForkMessage | deleteAndForkMessage)
   → emitSyntheticSkillLoads → runV3TurnInListener
        → runV3Turn (conversation-stream-client.ts): POST /turns, then XHR GET /stream?since=
             deltas → addStreamingMessage; committed rows → live tool rows; pending → derived below
        → loadConversationDetail (incremental ?since, view = dev-mode ? 'full' : 'display')
        → parsePiConversation → dispatch loadConversation (durable log is the truth)
        → status 'paused' → updateConversation({ pending_tool_calls })
                              ↓
          matcher(updateConversation | setUserInputResult) listener
                → executeToolCall (lib/tools/tool-handlers) under withToolWatchdog
                → completeToolCall
                              ↓
          completeToolCall listener: all results in? → runV3TurnInListener({ completedToolCalls })
```

`observeConversation` is the same stream read with no POST — used while a Remote Agent Session drives the conversation externally; `renderFromDurableLog` re-renders on a 150 ms debounced, strictly-chained promise so reloads never interleave with the `pending` dispatches that must follow them.

**Navigation.** `LayoutWrapper` dispatches `setNavigation`; `navigationListener.ts` maps `/f/{id}` → `readFiles([id])` and `/p/{path}` → `readFolder(path)`; `appStateSelector.ts` recomputes `AppState` from the same Redux state. Independently, `useRouter().push/replace` calls `beginNavigation()`, and `LayoutWrapper`'s pathname effect calls `endNavigation()` to flush whatever `runOrDefer` queued.

## Interactions with other areas

| Boundary | Direction | Contract |
|---|---|---|
| `components/containers/*` (15 files), `components/file-browser/*`, `components/modals/*` | → us | Containers are the only components allowed to touch Redux; views take props. Enforced for 10 named view files by `RESTRICT_VIEW_REDUX` in `frontend/eslint.config.mjs`. |
| `lib/tools/handlers/*` | → us | Frontend-bridged tools call `getStore()` and the `file-state` verbs directly (`edit-file.ts`, `create-file.ts`, `publish-all.ts`, `file-review.ts`, …). `chatListener` imports `tool-handlers` **dynamically** to break the cycle `tool-handlers → store → chatListener → tool-handlers`; it carries an explicit `eslint-disable-next-line no-restricted-syntax` because inline imports are otherwise banned repo-wide. |
| `lib/data/files.ts` (`FilesAPI`) | us → | Sole HTTP surface for file CRUD. `file-state` adds Redux + caching on top; nothing here calls `/api/files` by hand. `ConflictError.currentFile` is the 409 payload the publish path depends on. |
| `app/api/query` | us → | `getQueryResult` posts `{ query, connection_name, parameters, parameterTypes?, filePath?, fileId?, fileVersion?, cachePolicy?, forceRefresh? }` and reads a JSONL body plus the `X-Cached-At` header. |
| `lib/store/file-selectors.ts` | us → | `selectAugmentedFiles` / `selectAugmentedFolder` / `selectFilesByCriteria` / `selectFileByPath` live outside this area but are the augmentation layer both `file-read.ts` and `appStateSelector.ts` build on. |
| `lib/chat/compress-augmented.ts` | us → | `filesSlice` imports `dbFileToFileState` (the DbFile→FileState constructor, which deep-sorts content keys); `appStateSelector` imports `compressAugmentedFile` + `APP_STATE_LIMIT_CHARS`. Client and server read paths must produce identical compressed output — `store/__tests__/file-state-server-parity.test.ts` asserts it. |
| `lib/data/helpers/param-resolution.ts` + `lib/sql/sql-params.ts` | us → | `getRootParams` / `buildQueryParamValues` / `noneifyEmptyNumericParams` produce the *canonical* param map. Cache key, augmentation lookup key and `fileState.queryResultId` must all be derived from the same map. |
| `store/configsSlice` ← SSR `preloadedState` | env → us | `MAX_CONCURRENT_QUERIES` and `QUERY_TIMEOUT_MS` reach `querySemaphore` and the fetch timeout through Redux, read live on each acquire. |
| `lib/analytics/middleware.ts` | us → | Subscribed to every dispatched action; adding an action means it may become an analytics event. |
| `orchestrator/` + `agents/` | via HTTP | The listener never imports the orchestrator. Its only contract is the v3 route pair (`POST /api/conversations/[id]/turns`, `GET …/stream`) plus `/interrupt`, `/fork`, `/api/chat/log-error`. |
| `lib/navigation/nav-progress.ts` | us ↔ components | `runOrDefer` is called from `query-results.ts` and `components/containers/SmartEmbeddedQuestionContainer.tsx`; `endNavigation` only from `components/app-shell/LayoutWrapper.tsx`. |

## Gotchas

- **A same-version refetch preserves unsaved edits.** `fileStateFromServer` (`filesSlice.ts`) keeps `persistableChanges`/`ephemeralChanges`/`metadataChanges` unless the incoming `version` is strictly greater, or `overwriteEdits: true` is passed. Only `reloadFile` passes it. Without this an agent's staged dashboard edit was wiped by the very next `readFiles`; `store/__tests__/refetch-preserves-edits.test.ts` guards both directions.
- **`contentReplaced` changes save semantics.** `setFullContent` makes `persistableChanges` the *entire* content and flags the file, so `persistableContentOf` returns it verbatim instead of merging — that is the only way a key deletion survives a save. Later `setEdit` merges preserve the invariant (merging onto full content is still full content).
- **Two keys must never deep-merge.** `editFile` special-cases `viz` (the Viz V2 envelope is written whole; a merge resurrects deleted encoding channels), and `cellResults` goes through `setNotebookCellResults` with replace semantics (a partial map would drop already-saved cells, and a merge cannot delete one).
- **Negative ids are never sent to the server.** `pathToPlaceholderId` (`file-read.ts`) and `pathToVirtualId` (`filesSlice.ts`) are duplicate djb2 implementations that must stay in agreement; `loadFiles` filters out `id < 0`, and `reloadFile` refuses them. There are no client-created "virtual files" any more — `createDraftFile` gets a real positive id from the server immediately, with `draft: true` hiding it from folder listings until first save.
- **A cached error is "fresh".** `selectIsQueryFresh` deliberately treats an error as fresh within the TTL, and `getQueryResult` re-throws it without re-fetching. Removing that turns a failing query into an infinite retry loop on every render.
- **`MAX_CACHED_RESULTS = 256` is a correctness constant, not a memory knob.** Drop it below the largest dashboard's question count and each re-render evicts the earliest results, cascading into duplicate `/api/query` round-trips.
- **`CACHE_TTL.FILE/FOLDER/QUERY` are all ten hours** (`lib/constants/cache.ts`). The `120000` default on `selectIsQueryFresh` is the selector's own fallback and is not what callers pass.
- **Query concurrency is capped and time-boxed.** `querySemaphore`'s limit is a *getter* over `selectMaxConcurrentQueries`, so a runtime config change applies without recreating it (`lib/file-state/__tests__/query-concurrency-cap.test.ts`). Each fetch races an internal timeout against the caller's optional `signal`; an abort is normalised into "Query timed out after Ns" or "Query cancelled" so the UI and the agent never see a bare `DOMException`. Only timeouts and network/5xx failures are reported via `captureError`; 4xx SQL errors and user cancellations are not.
- **`forceLoad` must reach the server.** `getQueryResult({…}, { forceLoad: true })` both skips the client cache and sets `forceRefresh: true` in the request body; a normal load must not (`query-force-refresh.test.ts`).
- **Redux writes during navigation are deferred.** `setQueryResult`/`setQueryError` go through `runOrDefer`, because urgent updates preempt and restart Next's low-priority navigation transition — clicking a dashboard tile while queries streamed felt dead. `beginNavigation` arms a 5 s safety timer so deferred work is never stranded if a navigation is cancelled.
- **`editFileStr` requires a UNIQUE match by default.** `replaceAll` defaults to **`false`**, so a non-unique `oldMatch` is an error telling the caller to either extend `oldMatch` with more context or pass `replaceAll: true` deliberately; only then is every occurrence replaced, and the result reports the count via `occurrences`. The edit surface is the MARKUP projection (`fileToMarkup`/`markupToContent`), **not** the file JSON, and the `id`/`name`/`path` wrapper is not part of the search space. A parse failure is the only hard error — schema and story-param problems come back as non-blocking `validation` strings, and Publish is the real gate. There is a deliberate *truthful no-op guard*: if the replacement changed the string but produced identical content, it returns `success: false` so the agent retries instead of believing a phantom edit.
- **The echoed diff is canonical, not the agent's text.** `editFileStr` diffs against the markup re-derived from Redux after staging, so the agent's next `oldMatch` (built from memory of its own `newMatch`) matches what is actually stored. `generateDiff` uses a Myers shortest-edit-script over lines, not a positional compare — a positional cascade turned one-line story edits into 100 KB payloads that compounded every turn (`lib/file-state/__tests__/generate-diff.test.ts`).
- **`selectDirtyFiles` excludes only `connection`, `config`, `styles`.** That set is narrower than `SYSTEM_FILE_TYPES` in `lib/ui/file-metadata.ts`, which also lists `context` — so context files *do* appear dirty and *are* published by `publishAll`.
- **Tool execution is guarded three ways.** `inFlightToolCalls` is populated synchronously before any `await`, so a re-fired listener cannot double-execute (`store/__tests__/chat-listener-inflight.test.ts`); calls are grouped by `arguments.fileId` — same file serial, different files parallel; and each is raced against `withToolWatchdog` at 6 minutes, which does *not* cancel the underlying work but swallows a late settlement so `completeToolCall` fires exactly once.
- **Chat tests do not stream.** `runV3TurnInListener` branches on `IS_TEST`: jsdom has no usable XHR/SSE, so it POSTs the turn and polls `ConversationsAPI.get` up to 600×10 ms until `runStatus !== 'running'`. The remote-session observer returns immediately under `IS_TEST`. Node tests drive `updateConversation` directly.
- **The message queue lives only in the live store.** `loadConversation` re-reads `queuedMessages` from the existing conversation and ignores the snapshot in its payload — turn-finalize dispatches carry a conversation captured at turn *start*, which would otherwise wipe anything queued mid-turn or resurrect flushed messages.
- **Both sidebars start collapsed, and only the restore pass opens them.** `uiSlice`'s initial
  `leftSidebarCollapsed` is `true` — not the user's preference — because SSR has no localStorage and any
  other default flashes the wrong chrome on hydration. `components/app-shell/DataLoader.tsx` reads the
  stored flags after mount and folds them into the same single `setBulkUiFlags` dispatch as `devMode`,
  so restoring N flags costs one re-render, and a key that is absent (not `'true'`/`'false'`) leaves the
  reducer default alone rather than writing `false`.
- **Opening the right sidebar overwrites the remembered left-sidebar preference.**
  `setRightSidebarCollapsed(false)` force-collapses the left sidebar *and persists that*, so the two are
  not independent memories: reopening the chat panel is a durable write to `leftSidebarCollapsed`.
  `persistBooleanPreference` swallows its own throw, because localStorage is unavailable in
  private/locked-down browsers and a preference write must never break a toggle.
- **Dev mode changes the wire format.** `viewFor(state)` selects `'full'` vs `'display'`; toggling it invalidates the whole conversation-log cache, because slim and full entries must never mix in one log, and re-renders settled conversations so the inspector has data without a reload. The listener watches both `setDevMode` and `setBulkUiFlags` (localStorage restore at boot races the page-level fetch).
- **Incremental conversation loads have two guards.** `loadConversationDetail` only accepts a `?since` response when the returned seqs are contiguous with the cached prefix *and* the merged length matches the server's `maxSeq` — the second guard catches a truncate-and-replay retry that removed rows the client still holds. An errored turn skips the incremental path entirely.
- **Sanctioned module-level state.** `chatListener.ts` (`abortControllers`, `observingConversations`, `inFlightToolCalls`), `conversation-log-cache.ts` (`cache`), and `use-story-preview-css.ts` (`cache`) each carry an explicit `eslint-disable-next-line no-restricted-syntax` with a reason: they are per-browser-tab, never server-side, so there is no cross-request leakage.
- **`selectSaveClassification` uses `weakMapMemoize`.** Reselect's default LRU size is 1, which thrashes when several components call it with different `fileId`s and returns a fresh object each time — React-Redux then warns and re-renders needlessly.
- **`useAppStore` is not `useAppSelector`.** `store/hooks.ts` exports it for reading state inside callbacks without subscribing — use it for values only needed at click/submit time (`queryResultsMap`, colour mode at send) so an unrelated slice update doesn't tear through the parent.
- **`withColorModeOverride`** (`store/color-mode-override.ts`) proxies only `getState`, memoised per underlying state reference; `dispatch`/`subscribe` pass through. It is how a story declaring `colorMode: "light"` themes its embedded charts inside a dark app without any chart component learning about it.

## Key files

| Task | File |
|---|---|
| Add/change a file operation | `frontend/lib/file-state/file-read.ts` · `file-edit.ts` · `file-publish.ts` · `file-mutations.ts` (re-export via `file-state.ts`) |
| Change how queries execute or cache client-side | `frontend/lib/file-state/query-results.ts` + `frontend/store/queryResultsSlice.ts` |
| Change the dirty/save model | `frontend/store/filesSlice.ts` (`fileStateFromServer`, `persistableContentOf`, `selectDirtyFiles`, `selectSaveClassification`) |
| Add a React hook over files/queries | `frontend/lib/hooks/file-state-hooks.ts` |
| Change chat turn orchestration in the browser | `frontend/store/chatListener.ts` |
| Change the SSE/turn transport | `frontend/store/conversation-stream-client.ts` · `store/conversation-log-cache.ts` |
| Change conversation state shape | `frontend/store/chatSlice.ts` |
| Change what the LLM sees as page state | `frontend/store/appStateSelector.ts` |
| Add a route → data mapping | `frontend/store/navigationSlice.ts` + `frontend/store/navigationListener.ts` |
| Add a UI flag (with localStorage persistence) | `frontend/store/uiSlice.ts` |
| Server-side file reads for tools/jobs | `frontend/lib/file-state/file-state.server.ts` |
| Preserve `as_user` / `mode` / `view` across a navigation | `frontend/lib/navigation/url-utils.ts` · `use-navigation.ts` |
| Block navigation on unsaved changes | `frontend/lib/navigation/NavigationGuardProvider.tsx` |
| Keep a link inside a story/dashboard surface a client navigation | `frontend/lib/navigation/surface-link-bridge.ts` |
| Stop a server-rendered form field losing what was typed before hydration | `frontend/lib/hooks/use-prehydrated-value.ts` |

**One extraction produces a story's embed runs for every consumer.** `storyEmbedRuns` (`lib/data/helpers/param-resolution.ts`) is the single place that walks a story body for inline `<Question>` and `<Number>` embeds and resolves each one's params. Four independent callers depend on it agreeing with itself — the client augmentation that fills `queryResults`, the server-side `executeQueriesForFile`, EditFile's post-edit auto-execute, and the renderer (`components/views/story/InlineNumber.tsx`) — because each computes `getQueryHash(query, params, connection)` and a divergence does not throw: the embed simply renders unbound, with no cached result to find. A fifth consumer must route through `storyEmbedRuns` / `bindReferencedParams` rather than re-deriving the set.

**Edit-time parameter lints are advisory, and there are exactly three.** `collectEditValidation` (`lib/file-state/file-edit.ts`) runs on every edit, always applies the edit, and returns `validation: string[]` as text the agent can self-correct from. `lintStoryParams` flags a `:name` an embedded question needs with no `<Param>` declared, a declared/used type mismatch, and a declared-but-unused param. `lintStoryParamSources` flags a `<Param id={N}>` importing from a file that does not exist or is not a question. `lintDashboardParams` flags one `:name` used at two different types across questions — auto-derive then silently produces two separate filters instead of one shared one. All three live in `lib/data/story/story-params.ts`; save/publish, not the edit, is the hard gate. `lintStoryParamSources` covers a second source kind: a `<Param query={…}>` whose `connection` is
missing. That is not cosmetic — `extractInlineFileQueries` and `storyEmbedRuns` both require
`query && connection` before admitting a param source, so a connection-less inline source is silently
absent from the executed set *and* from the public-share allowlist: the control renders with no
options and a guest's fetch is denied outright. The lint is the only place that failure is visible
before a reader hits it.

---
