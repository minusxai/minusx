# Chat serving — the turn pipeline

How a chat turn is actually served: request → orchestrator → durable rows → resumable SSE. This doc
covers `lib/chat` (turn orchestration, the registrables hub, agent-args resolution, remote agent
sessions, the headless report/eval/micro-task runners), `lib/llm` (provider config and per-call
model resolution) and `lib/projection` (the LLM-facing facet projection) — plus the
`lib/chat-translator`, `lib/convo-debug` and `lib/evals` leaves that nothing else documents. The
engine it drives is `frontend/orchestrator/`; the agents it selects are in `frontend/agents/`.

Conversations are rows, not files: they live in dedicated `conversations` + `messages` tables and
stream over Postgres LISTEN/NOTIFY (see "Decisions not to re-litigate").

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## The turn pipeline

```
POST /api/conversations/:id/turns          (app/api/conversations/[id]/turns/route.ts)
  ├─ ownership + mode check, runStatus gates
  ├─ boundContextAppState(agentArgs.app_state)        ← lib/chat/compress-augmented.ts
  ├─ acquireRunLease + notifyStatus('running')        ← synchronous, before responding
  └─ void runConversationTurn(...)   detached; returns { ok:true, started:true } immediately
        │
        ▼
runConversationTurn                        (lib/chat/conversation-turn.server.ts)
  ├─ loadLog(conversationId)                          ← lib/data/conversations.server.ts
  ├─ setupOrchestration(body, user, id, {savedLog, fileMeta})
  │      └─ lib/chat/orchestration-core.server.ts
  │           ├─ buildServerAgentArgs  (lib/chat/agent-args.server.ts) — schema/context/connection
  │           ├─ pick registrables (prod / benchmark-V1 / benchmark-V2 / headless)
  │           ├─ createTrackedOrchestrator({registrables, savedLog, user, tracking, gradeOverride})
  │           │      └─ lib/chat/tracked-orchestrator.server.ts — pre-wires beforeLlmCall
  │           │        (creditEnforcer), resolveLlmPlan (buildLlmPlanResolver) and recordUsage
  │           └─ orch.run(rootAgent)  |  orch.resume(piToolResults)
  ├─ for each stream event: buffer text/thinking deltas → notifyDelta
  │                         commitNew() → appendMessages + notifyMessage
  ├─ mirrorErrors → appendError (kind='error' rows)
  ├─ setup.recordUsage(piDiff) (llm_call_events + llm_logs + AppEvents.LLM_CALL)
  └─ releaseRunLease(idle|paused|error) + notifyStatus

GET /api/conversations/:id/stream?since=N  (app/api/conversations/[id]/stream/route.ts)
  catch-up SELECT past cursor → subscribe(conversationId) → tail wakeups → done
```

The turn runner never writes to the HTTP response. `messages` rows are the source of truth; NOTIFY is
only a wakeup pointer. `lib/chat/conversation-stream.server.ts` is the bus: one Postgres `LISTEN` per
conversation channel (`namespacedChannel(isolation, 'conv_<id>')` — `nsmx_conv_5` by default),
fanned out to in-process subscribers from a module-global `Map`.

## What each module owns

**`frontend/lib/chat/tracked-orchestrator.server.ts`** — the ONE sanctioned way to construct an
`Orchestrator` for a production LLM run. `createTrackedOrchestrator` pre-wires the three per-run
obligations (credit gate, DB-backed model-plan resolver, usage recording bound to a
conversation-or-task attribution) that were previously hand-copied — and forgotten — per runner.
A bare `new Orchestrator(...)` in app code is a lint error (`eslint.config.mjs`); constructions
that genuinely run no LLM loop (remote-session-engine, tool-inspector) and the deliberately
untracked benchmark CLI suppress inline with a justification. Also owns the conversation-bound
recorder `recordLlmCalls`. A leaf module on purpose: it must never import the registrables hub.

**`frontend/lib/chat/orchestration-core.server.ts`** — the registry hub and the agent/context build.
It owns `REGISTRABLES` / `HEADLESS_REGISTRABLES`, `setupOrchestration` and `previewNextChatContext`.
It does *not* own persistence, streaming, or the HTTP layer: it returns an
`Orchestrator` plus a raw stream (and the factory's `recordUsage`) and lets the caller drive it.
Importing this module has a side effect — it calls `setLlmCallRecorder` (from `@/orchestrator/llm`)
once, which persists every LLM request row at call time.

**`frontend/lib/chat/conversation-turn.server.ts`** — one turn segment end to end: lease, commit,
delta buffering, error mirroring, usage recording, auto-retry of a crash-interrupted turn, and the
first-turn AI title (via `runMicroTask('title', …)`). It owns nothing about *which* agent runs.

**`frontend/lib/chat/conversation-stream.server.ts`** — the wakeup bus only (`notifyMessage`,
`notifyDelta`, `notifyStatus`, `notifyInterrupt`, `subscribe`). No SSE, no serialization, no cursor
logic — those live in the stream route.

**`frontend/lib/chat/chat-types.ts`** — the `ChatRequest` / `CompletedToolCallResult` /
`LLMCallDetail` shapes. Despite the name it is a *types* module; no chat engine lives here.

**Remote agent sessions** — `frontend/lib/chat/remote-session.server.ts` (mint / end / resolve a
bearer code), `frontend/lib/chat/remote-session-engine.server.ts` (execute one externally-authored
tool call by reconstructing an `Orchestrator` from the durable log and calling `orch.dispatch`),
`frontend/lib/chat/remote-session-content.server.ts` (orchestrator content blocks → wire blocks,
inlining auth-gated object-store URLs as base64). They own no LLM loop: a remote session never runs
an agent's `run()`.

**Headless runners** — `frontend/lib/chat/run-report.server.ts` (`ReportAgent`, result read off
`agent.runResult`; every call in the run pinned to the `report` agent policy via the factory's
`llmAgent`), `frontend/lib/chat/run-eval.server.ts` (`EvalAnalystAgent`, returns the last
Submit tool result), `frontend/lib/chat/run-micro-task.server.ts` (`MicroAgent`, no tools, returns
text). All three build through `createTrackedOrchestrator` with `tracking: {task}` — gate, plan and
recording come pre-wired. `frontend/lib/chat/headless-llm-tracking.server.ts` holds
`buildLlmCallDetail`, `collectLlmCallDetails` (which also finds sub-agent final replies folded into
`mx_agent` toolResults — a plain entry scan silently drops each dispatched sub-agent's last call)
and `recordHeadlessLlmCalls` in a leaf module so `runMicroTask` can record usage without importing
the registrables hub (that import cycle is why it exists).

**Shared chat helpers in `frontend/lib/chat/`** — `agent-args.server.ts` (server-side resolution of
connection + whitelisted schema + context docs, the single source for every server-initiated
conversation), `compress-augmented.ts` (`FileState`/`DbFile` → `CompressedAugmentedFile`),
`markup-blocks.ts` and `file-encoding.ts` (markup pulled out of JSON; `encodeFileStr` keeps raw
newlines so `EditFile.oldMatch` matches), `render-schema-prompt.ts` (schema table-of-contents with a
char budget), `error-retryability.ts` (transient vs terminal turn errors),
`streamed-tool-calls.ts` (committed pi rows → live `CompletedToolCall` rows in the UI),
`clarify-answer-stash.ts` / `edit-with-agent.ts` / `paste-attachment.ts` (client-side),
`attachments.server.ts` (normalize `agent_args.attachments`), `llm-calls.ts` (browser fetch clients
for the debug endpoints), `tool-inspector.server.ts` (admin re-run of one registered leaf tool).

**`frontend/lib/llm/`** — provider configuration and per-call model resolution.
`frontend/lib/llm/llm-config-types.ts` is the pure contract (`LlmGrade` = `lite|core|advanced`,
`LlmProviderEntry`, `LlmGradeAssignments`, `DEFAULT_AGENT_POLICIES`, `resolveAgentPolicy`,
`hasLlmEndpoints`) shared by server resolution and the settings UI.
`frontend/lib/llm/llm-plan.server.ts` resolves a `LlmPlanSelector` → `LlmPlanStep` on every call.
`frontend/lib/llm/compat-models.ts` reads `frontend/compatibility.json` for the per-provider
per-grade "Auto" default. `frontend/lib/llm/minusx-default.ts` builds the managed-gateway model
handle. `frontend/lib/llm/model-catalog.server.ts` overlays models.dev onto the baked pi-ai registry.
`frontend/lib/llm/chat-grade-catalog.ts` projects config → the chat picker.
`frontend/lib/llm/llm-test.server.ts` is the one-shot connectivity probe.
Provider configuration lives in the DB (or arrives from the gateway); there is no env-var
seeding path — `ANALYST_AGENT_MODEL_CONFIG` survives only as a runner-side hint in
`frontend/test/qa/auth.setup.ts`. This tree owns no prompt, no agent, and no usage accounting.

**The `minusx` provider is checked FIRST in `planFromConfig`, ahead of any stored grade mapping.**
Choosing the managed gateway is choosing to have model selection managed; a per-grade mapping
alongside it produces a half-managed workspace — some grades routed by MinusX, others pinned to a
vendor model it knows nothing about, and no single place that answers "what runs this?". Settings
hides the per-grade pickers while a `minusx` provider is configured (omitted, not disabled: a disabled
picker advertises a decision the admin does not get to make), but a mapping stored *before* MinusX was
added would otherwise still be honoured at plan time, which is what the ordering prevents. The full
ladder is: `minusx` provider → `llm.grades[grade]` → the workspace's sole bring-your-own-key provider
run as "Auto" → a hard error naming the unmapped grade. That ladder runs only when
`hasLlmEndpoints(llm)`; a workspace with no configured endpoint never reaches it and gets the managed
gateway on the `mx-unconfigured` key sentinel, so the failure is one clear auth error pointing at
Settings → Models rather than a silent fallback to some other vendor's model.

**Two routing headers ride every managed call.** `minusxCallOptions(grade, agent, extraHeaders)` emits
`X-MX-Use-Case` (the capability grade) and `X-MX-Agent` (the task kind, an `LlmAgentKey`). The gateway
resolves `agent:grade` first and falls back to `grade`, so the second header is purely additive — an
agent with no override routes exactly as it did on grade alone. It exists because grade by itself
discards the strongest predictor of which model wins: a Slack one-liner and a long analyst tool loop
are not the same workload at the same capability tier. `buildPlanStep` therefore takes `agent` as a
**required** parameter, ahead of the optional `catalog`, so a new caller that omits it is a type error
rather than a silently un-routed managed call.

**`frontend/lib/projection/`** — the **LLM-facing facet projection**:
`frontend/lib/projection/facets.ts` (`FacetMemo`, stable `facetHash`),
`frontend/lib/projection/types.ts` (rich `AugmentedFiles` vs projected JSON),
`frontend/lib/projection/from-compressed.ts` (`CompressedAugmentedFile` → `AugmentedFiles`),
`frontend/lib/projection/project.ts` (per-facet diff → lean JSON + out-of-JSON blocks),
`frontend/lib/projection/render.ts` (blocks → `<AppState>` / `<file_markup>` / `<file_markup_delta>` / `<query_data>` +
image content), `frontend/lib/projection/messages.ts` (`projectMessages` — the single pass over an
assembled `Message[]`), `frontend/lib/projection/image-validate.ts` (`imageContentFromUrl`,
`assertValidProviderImages`).
`frontend/lib/projection/app-state-size.ts` measures the *projected* size of an app state, which is
what the chat client uses to decide whether to inject the `large_file` system skill.
`JSON.stringify(appState).length` is wrong by an order of magnitude here — the projection pass strips
query-result ROWS and never emits reference markup, yet both dominate the raw Redux object — so the
threshold is measured by actually rendering: `projectedAppStateChars` runs `renderAppState` through a
**fresh** `FacetMemo` (a shared one collapses repeats to `{unchanged:true}` and reports ~0 on the
second call) and sums the text blocks only. Image blocks count zero: they are screenshots, and the
skill is about markup the model must read and rewrite.

**`frontend/lib/convo-debug/`** — the `/debug` conversation visualization model:
`frontend/lib/convo-debug/actual.ts` (recorded calls + `requestJsonToInput` for the "Raw" source),
`frontend/lib/convo-debug/approx.ts` (chars/4 text, `(w×h)/750` images),
`frontend/lib/convo-debug/components.ts` (message → component breakdown, splitting on the
projection's own tags), `frontend/lib/convo-debug/turns.ts` (wire messages → bars),
`frontend/lib/convo-debug/costs.ts` (expected under the clean-prefix caching recurrence vs actual
usage), `frontend/lib/convo-debug/vega-spec.ts` (Vega-Lite stacked-bar spec). Pure and React-free;
the `ConvoDebug*` components under `frontend/components/explore/` render it.

**`frontend/lib/chat-translator/`** — orchestrator pi log ↔ legacy task-log shape. Three pure
functions in `frontend/lib/chat-translator/index.ts`: `piLogToLegacy` (display structs),
`legacyLogToPi` (seed a pi log from a task log), `legacyToolResultToPi` (frontend tool results →
`ToolResultMessage` for `orch.resume`).

**`frontend/lib/evals/`** — the `TestRunner` contract plus shared comparison helpers
(`frontend/lib/evals/index.ts`), a server runner (`frontend/lib/evals/server.ts` — `FilesAPI` +
`runQuery` + `runEvalV2`) and a client runner (`frontend/lib/evals/client.ts`, which runs *query*
tests in the browser through `lib/file-state/file-state.ts` but POSTs *llm* tests to
`/api/jobs/test`, i.e. back to the server runner).

## Two different things called "projection"

Unrelated, and routinely confused:

- **`frontend/lib/projection/`** projects *toward the model*: rich append-only log state →
  cross-turn-deduped LLM content. Consumers: `frontend/agents/analyst/analyst-agent.ts`,
  `frontend/lib/tools/handlers/{read-files,edit-file,create-file}.ts`,
  `frontend/lib/chat-translator/index.ts`, `frontend/lib/screenshot/app-state-screenshot.ts` and
  `frontend/components/explore/ChatInterface.tsx` (the `large_file` size probe).
- The **display-vs-full wire projection** projects *toward the browser*: `parseConversationView` /
  `projectLogEntryForDisplay` in `frontend/lib/data/conversation-projection.ts` (not in this area).
  The stream route display-projects every catch-up row unless the client passes `?view=full`.

## Interactions with other areas

**Callers into this area**

| Caller | Enters at | Contract |
|---|---|---|
| `frontend/app/api/conversations/[id]/turns/route.ts` | `runConversationTurn` | fired detached; route already holds the lease |
| `frontend/app/api/conversations/[id]/stream/route.ts` | `subscribe` | wakeup only; rows come from `loadMessages` |
| `frontend/app/api/conversations/[id]/interrupt/route.ts` | `notifyInterrupt`, `endRemoteSession` | Stop button |
| `frontend/lib/integrations/slack/run-turn.server.ts` | `runConversationTurn`, `piLogToLegacy` | same runner as the browser; sets `agent: 'SlackAgent'` itself |
| `frontend/app/s/[code]/{route,tool,end,result/[toolCallId]}` | `resolveRemoteSession`, `executeRemoteToolCall`, `getRemoteToolResult`, `endRemoteSession` | bearer-code auth via `frontend/lib/http/with-remote-session-auth.ts` |
| `frontend/app/api/chat/debug-context/route.ts` | `previewNextChatContext` | admin-only; returns the exact next-turn `Context` |
| `frontend/app/api/tools/schema/route.ts` | `REGISTRABLES` | OpenAI-style function schemas for the dev tool tester |
| `frontend/app/api/tools/execute/route.ts` | `executeRegisteredTool` | admin Tool Inspector |
| `frontend/app/api/micro-task/route.ts` | `runMicroTask` | |
| `frontend/lib/jobs/handlers/{alert-handler,context-handler}.ts`, `frontend/app/api/jobs/test/route.ts` | `createServerRunner` → `runEvalV2` | |
| `frontend/app/api/llm/{test,chat-models,registry}/route.ts`, `frontend/scripts/setup-cli/{validate-llm,list-models}.ts` | `testLlmEntry`, `buildChatGradeCatalog`, `mergedListModels` | |
| `frontend/lib/modules/auth/index.ts` | `registerCompanyWithGateway` | at workspace registration, and only when no installer-supplied `llm` config was passed |
| `frontend/lib/mcp/session-logger.ts`, `frontend/lib/data/migrate-conversations-v3.server.ts` | `legacyLogToPi` | |
| `frontend/app/benchmark/page.tsx`, `frontend/lib/conversations-utils.ts` | `piLogToLegacy` | `parsePiConversation` reuses it for render structs |
| 27 non-test modules, repo-wide (see the note below) | `compress-augmented.ts` | shared file→model compression contract |

`frontend/lib/chat/compress-augmented.ts` looks like a chat-internal helper and is not one: it is the
shared file→model compression contract (`compressAugmentedFile`, `compressQueryResult`,
`dbFileToFileState`, `boundContextAppState`, the `AGENT_DRAIN_MAX_BYTES`/`*_LIMIT_CHARS` budgets).
Its blast radius is not "agents": the 27 non-test importers span `frontend/agents/**` (every DB
tool), `frontend/lib/tools/handlers/**`, `frontend/lib/appState.ts`, `frontend/store/filesSlice.ts`
and `frontend/store/appStateSelector.ts`, `frontend/lib/mcp/server.ts`,
`frontend/lib/file-state/file-state.server.ts`, `frontend/lib/connections/execute-query.server.ts`,
`frontend/components/connection-wizard/**`, `frontend/components/share/SharePageClient.tsx` and the
`turns` / `remote-session` conversation routes. Changing its output shape changes what every agent
sees *and* what Redux stores.

**What this area calls out to**

- `frontend/lib/data/conversations.server.ts` — `loadLog`/`loadMessages`/`appendMessages` (optimistic
  concurrency: a base-seq mismatch throws `ConcurrentAppendError`), `acquireRunLease`/
  `heartbeatRunLease`/`releaseRunLease`/`isRunLeaseStale`, `truncateMessagesFrom`, `appendError`,
  `setLastContextTokens`, `MAX_AUTO_RETRIES`.
- `frontend/lib/modules/registry.ts` — `getModules().db.notify` / `.listen`. `conversation-stream.server.ts`
  throws `DB module does not support LISTEN/NOTIFY` if an adapter lacks them.
- `frontend/lib/data/configs.server.ts` + `frontend/lib/secrets/config-secrets.server.ts` — the `llm`
  section of the org config; `@SECRETS/…` refs are resolved at plan time and injected as call
  options, never stored on a model handle.
- `frontend/lib/analytics/file-analytics.db.ts` (`recordLlmRequest`/`recordLlmResponse`/
  `recordLlmCallEvent`), `frontend/lib/analytics/credit-usage.server.ts` (`creditEnforcer`),
  `frontend/lib/app-event-registry` (`AppEvents.LLM_CALL`, `AppEvents.REMOTE_TOOL_CALL`).
- `frontend/orchestrator/` (`Orchestrator`, `UserInputException`, `validateParameters`) and
  `frontend/agents/**` for every registrable class.
- `frontend/lib/object-store` — remote-session image inlining.

## Gotchas

- **NOTIFY is lossy by design.** Correctness comes from the cursor + catch-up `SELECT`; a wakeup lost
  while nobody listens is harmless. Never move state into a notify payload — deltas ride inline only
  because they are ephemeral.
- **The root invocation is committed eagerly** (`commitNew()` before the stream loop) so a crash mid-turn
  still leaves the user message durable. That is what makes auto-retry idempotent: `prepareAutoRetry`
  truncates from `run_started_seq` and replays the preserved user message.
- **The turns route deliberately preserves `run_started_seq` on an auto-retry** instead of using
  `maxSeq + 1` — overwriting it would point the truncate *past* the crashed rows.
- **Resume-turn crashes are not auto-retried.** `prepareAutoRetry` bails unless the row at
  `run_started_seq` is a root invocation carrying a `userMessage`; truncating a half-applied
  frontend-tool resume is unsafe. A manual "Try again" resets the retry budget first, then takes the
  same path.
- **Delta buffering is tagged by kind.** Thinking and text share one buffer with a `thinking` flag and
  a flush on kind switch; merging them untagged made reasoning render as the visible reply.
- **`runStatus === 'remote'` freezes the conversation.** The turns route refuses user messages and
  retries, and allows exactly one write: `appendRemoteToolCompletions`, which is append-only (map to
  pi toolResults, thread to the owning assistant entry, dedupe already-resolved ids) — no orchestrator,
  no LLM.
- **`REGISTRABLES` has derived registries, so one array edit lands in four surfaces.**
  `HEADLESS_REGISTRABLES` is `withSwaps(REGISTRABLES, HEADLESS_TOOL_SWAPS)` — Slack, report and eval
  pick a new tool up for free. `REMOTE_REGISTRABLES` is `REGISTRABLES` minus `type === 'Agent'`, plus
  `RemoteSessionAgent`, so an external agent can never *dispatch* a name that would start a nested
  LLM loop; `tool-inspector.server.ts` applies the same leaf-only guard against `REGISTRABLES`
  directly. What a remote agent may *call* is a separate, narrower gate: `REMOTE_TOOL_NAMES` is
  `RemoteSessionAgent.tools` (WebAnalystAgent's leaf tools minus `ClarifyFrontend`), checked before
  dispatch — so registering a tool does not by itself expose it over `/s/<code>/tool`.
- **A stale bridged remote call is closed on the agent's NEXT call, never by a poll.**
  `getRemoteToolResult` only flags `browserMaybeUnreachable` — a pending human confirmation
  (Navigate/PublishAll) must not be force-closed.
- **`ROOT_AGENT_BY_NAME` is a `Map`, not an object literal**, specifically so a user-controlled
  `body.agent` cannot reach `constructor` / `__proto__`. Unknown names fall back to `WebAnalystAgent`.
- **A resolved custom-agent pointer outranks `body.agent`.** `agent_args.custom_agent` is a NAME on the
  resolved context, not a class name, and `setupOrchestration` picks `CustomAgent` whenever it resolves.
  `ROOT_AGENT_BY_NAME` still carries a `'CustomAgent'` entry so a client that echoes back
  `agent: 'CustomAgent'` on a later turn stays stable rather than silently reverting to the analyst.
- **`HEADLESS_TOOL_SWAPS` exists because the default `ReadFiles` is the frontend-bridged variant.**
  With no browser it throws `UserInputException`, dangles as a pending tool, and the agent can never
  finish — so Slack/report/eval swap in the server-side `ReadFiles`.
- **V1 vs V2 benchmark conversations share `schema.name = 'DoubleCheckBenchmarkAgent'`**, so
  `isV2BenchmarkConversation` scans the saved log for V2-only markers (`V2BenchmarkAnalystAgent`,
  `Explore`, `fetchHandle`) instead of trusting the root name.
- **`resolveLlmPlan` returns `null` unconditionally under `E2E_MODE`, but under vitest only for an
  UNCONFIGURED workspace.** The E2E short-circuit is the first line of the function, so a DB config
  can never override an agent's faux static model there. The plain-test `null` is the *last* line
  (`isTestEnv()`), reached only after `hasLlmEndpoints(llm)` fails — a test that writes an `llm`
  section resolves a real plan and will try to reach a real provider.
- **An `llm` section carrying neither providers nor grades is treated as unconfigured** (`hasLlmEndpoints`)
  and routes to the managed gateway — that empty section is what Settings → Models leaves behind when
  the last provider is deleted, and the page offers no way to remove it.
- **`buildPlanStep` ignores `choice.model` for the `minusx` provider** (always the `minusx-auto`
  sentinel; the gateway routes by the `X-MX-Use-Case` header) and moves `amazon-bedrock`'s key from
  `apiKey` to `bearerToken`.
- **LLM config is workspace-level**: `resolveLlmPlan` reads `getRawConfig(DEFAULT_MODE)` regardless of
  `user.mode`. Tutorial chats run on the same providers as org chats — mode isolation covers files, not
  credentials.
- **`setLlmCallRecorder` is an import side effect** of `orchestration-core.server.ts`. Runners that do
  not import that module (the benchmark CLI) write no `llm_logs` request rows.
- **`FacetMemo` is forward-only, with exactly one exception.** A turn may be slimmed relative to
  earlier turns, never the reverse, so re-projecting the whole log leaves earlier messages
  byte-identical and the provider prompt-cache prefix holds; `projectMessages` creates a fresh memo
  per pass for exactly this reason. The exception is the superseded-screenshot pre-scan: only the
  LAST screenshot per file id keeps its image, and every earlier one is rewritten to
  `SUPERSEDED_SCREENSHOT_STUB`. That is bounded on purpose — in an edit loop the previous
  screenshot-bearing edit sits near the tail, so only a short cache suffix is clipped. Any *new*
  backward rewrite is not bounded that way and will invalidate the whole prefix.
- **Markup is the one facet sent INCREMENTALLY.** Every other facet is all-or-nothing: hash equal →
  `{unchanged:true}`, hash different → the whole value. On a document the agent edits one line at a
  time that is pathological — a 40-section story measured ~5.5k tokens *per turn* while being edited
  against 42 tokens per turn while idle, which is what filled the window in a couple of exchanges.
  So a changed `file:<id>:content` is emitted as a line diff (`<file_markup_delta>`, the same
  `generateDiff` the EditFile echo uses) against the last copy sent in FULL, dropping the same case
  to ~400 tokens. Three invariants keep it honest, all in `project.ts` / `facets.ts`: only a **full**
  emission records a delta base (`FacetMemo.rememberBody`), so a diff never rebases onto text the
  model was never shown; `FacetMemo.reset()` clears the bases with the hashes, because past a
  summarization boundary the base is no longer in the window; and a delta above `MAX_DELTA_RATIO`
  (half the document) falls back to the full markup, which re-bases and stops the diff growing
  without bound as the document drifts. The block is labelled in the prompt as a diff *and* tells the
  model to strip `+`/`-` prefixes before reusing a line in `oldMatch` — unlabelled, it reads as a
  very short document.
- **Images diff on `key`, never on the payload** (`file:<id>:image`, `qr:<queryResultId>:image`), so base64 is
  never hashed. A `data:` URL placed in `ImageContent.url` is the bug that shipped once (the provider
  reported an undefined MIME type) — `imageContentFromUrl` and `assertValidProviderImages` exist to
  keep it from recurring.
- **`boundContextAppState` mutates the parsed app state in place**, server-side, before the
  orchestrator sees it. It re-shapes only oversized (>200k char) context markup, so the normal path is
  byte-for-byte untouched; it is defense against a stale client shipping a multi-MB schema cache.
- **`ChatRequest.log_index`, `.source` and `.resume` are read by no route.** Fork takes `atSeq`,
  reconnect is `GET …/stream?since=<cursor>`, and the LLM-call `trigger` is derived from
  `agent_args.app_state` (`getPageType`), not from `source`. `agent_args` is also wider at runtime
  than its declared type: `setupOrchestration` reads every field off an untyped cast, and
  `allowed_viz_types`, `agent_name`, `unrestricted_mode`, `city`, `viewport` and `attachments`
  appear nowhere in `ChatRequest` — the interface is not a reliable inventory of what the server
  actually reads, so grep `setupOrchestration` before assuming a field is unused.
- **The client sends only pointers.** `context_file_id` / `context_version` / `connection_id` are
  resolved server-side by `buildServerAgentArgs`; schema and context docs are never taken from the
  request body, so the browser cannot inject context it did not earn.
- **`buildServerAgentArgs` deliberately leaves the connection unset** when several are available and
  none was selected (Slack / remote / cron). Locking to the first one sent every Slack query to the
  wrong database; the agent picks per query via `ListDBConnections`.

## Key files

| Task | File |
|---|---|
| Construct an orchestrator (gate/plan/recording pre-wired) | `frontend/lib/chat/tracked-orchestrator.server.ts` |
| Add/remove a tool or agent from chat | `frontend/lib/chat/orchestration-core.server.ts` (`REGISTRABLES`) |
| Change what a turn persists / when it notifies | `frontend/lib/chat/conversation-turn.server.ts` |
| Change the wakeup bus or channel naming | `frontend/lib/chat/conversation-stream.server.ts` |
| Change what the server resolves from a chat request | `frontend/lib/chat/agent-args.server.ts` |
| Change grade → provider/model resolution | `frontend/lib/llm/llm-plan.server.ts` |
| Change gateway registration, status or billing | `frontend/lib/gateway/` (+ `frontend/app/api/gateway/status/route.ts`) |
| Add a provider or change grade policy defaults | `frontend/lib/llm/llm-config-types.ts`, `frontend/compatibility.json` |
| Change what the model sees for a file page | `frontend/lib/projection/project.ts`, `frontend/lib/projection/render.ts` |
| Change file→model compression budgets | `frontend/lib/chat/compress-augmented.ts` |
| Debug a remote agent session | `frontend/lib/chat/remote-session-engine.server.ts` |
| Add a headless run type | `frontend/lib/chat/run-report.server.ts` (pattern), `frontend/lib/chat/run-micro-task.server.ts` |
| Change the `/debug` cost model | `frontend/lib/convo-debug/costs.ts`, `frontend/lib/convo-debug/turns.ts` |
| Change chat error → "Try again" vs "new chat" | `frontend/lib/chat/error-retryability.ts` |

## Decisions not to re-litigate

**Error rows live in `messages` with `seq = NULL`, and that is load-bearing.** A `kind='error'` row carries `{source, message, details}` in `content` and never consumes a log index. NULLs are distinct under a UNIQUE constraint, so `UNIQUE(conversation_id, seq)` still guards the append-only log while permitting many error rows against the same turn; `MAX(seq)`, `loadLog` (`WHERE seq IS NOT NULL ORDER BY seq`) and `truncateMessagesFrom` all skip them, so errors can never leak into the reconstructed `ConversationLog` or the orchestrator's context. `loadErrors` reads the parallel stream by `created_at, id`. Any new message kind must pick a side: sequenced and visible to the model, or `seq = NULL` and invisible to it.

**Never NOTIFY per token.** Sub-message deltas are batched to `DELTA_FLUSH_MS` (50 ms, with an immediate flush on a thinking↔text kind switch) before a single wakeup goes out. A per-token NOTIFY floods Postgres and, worse, saturates PGLite's single serialized connection — every `query`/`exec`/`notify` funnels through one promise chain there, so a token-rate notify stream starves real queries behind it. Losing a delta is harmless: the finalized message is committed durably and a reconnect replays it from the cursor.

**Conversations are deliberately not files.** They are append-only event logs, not user-authored documents, and forcing them through file CRUD meant carrying save/dirty/publish/references/markup/path machinery none of which applies, plus a translation layer between the `files` row and the log the orchestrator actually consumes. They now own `conversations` + `messages`, and `content` stores each log entry **verbatim** — reconstruction is literally `SELECT content … WHERE seq IS NOT NULL ORDER BY seq` into the exact `ConversationLog` array the orchestrator already takes, with `seq` doubling as the log index and the stream cursor. Normalizing messages into a bespoke schema, or moving them back onto `files`, reintroduces the translation layer both decisions removed.

**The in-memory run registry is gone and must not come back.** It buffered every stream frame of every run for a five-minute retention window — unbounded memory growth under load — was per-process, so any deploy or crash dropped every in-flight turn and left the client falling back to file recovery, and was single-instance by construction. What replaced it is the DB as source of truth plus a resumable read. The one in-memory structure that survives is the opposite thing: an ephemeral per-process set of currently-open SSE writers that one shared `LISTEN` connection fans wakeups out to, bounded by live connections, rebuildable, and emptied on disconnect.

**The display wire view shrinks entries; it never drops them.** `projectLogEntryForDisplay` (`lib/data/conversation-projection.ts`) leaves entry count, order, ids, `parent_id` and timestamps byte-identical to the full log, because the client derives positions from the log it holds (`piLog.length`) and matches pending frontend-tool calls by toolCall block id — a removed entry would shift every later position and silently corrupt fork and resume rather than failing loudly. `display` vs `full` (`?view=`) is a **bandwidth knob, not a security boundary**: it is the requester's own conversation either way, and the client asks for `full` only when `ui.devMode` is on.

Three named sets drive the per-entry rules, and the sets are the pointer — the code is the list. `DETAILS_ONLY_TOOLS` (EditFile, ReviewFile, Screenshot, ExecuteQuery) drop `content` entirely and keep `details` capped at `DISPLAY_DETAILS_CAP_CHARS` (32 K chars). `DERIVE_DETAILS_TOOLS` (twelve tools whose displays parse the result *text* because the tools never populate `details` — the search/read family plus `PublishAll`, `Navigate`, `Clarify`, `LoadSkill`, `LoadContext`) have `details` **derived from `content` at read time**, then `content` dropped — which is why the projection works retroactively on conversations written before it existed, with no write-path change. An unknown tool is treated conservatively: keep `details`, cap `content` at `DISPLAY_UNKNOWN_CONTENT_CAP_CHARS` (8 K chars). Error rows pass through untouched, and projecting an already-projected entry is a no-op. `parseToolContent` (`components/explore/tools/DetailCarousel.tsx`) falls back to `msg.details` whenever `content` is empty or unparseable, which is what lets every existing tool display keep working across both views and both eras of stored log.

**The lazy screenshot endpoint contains no tool names.** The display view rewrites any `details.screenshotUrl` holding an inline `data:` URI to `GET /api/conversations/:id/screenshots/:callId`; that route addresses the tool call by `toolCallId` and serves the *first inline image block in that call's response `content`* (`extractToolResultImage`) — content is the source of truth and `details` is never inspected for serving. It reuses the conversation's owner+mode gate and answers `Cache-Control: private, max-age=31536000, immutable`, safe precisely because a committed log entry never changes; remote (non-`data:`) URLs pass through untouched. The consequence — a screenshot stored twice, once as an image content block and once as `details.screenshotUrl` — is an accepted tradeoff, not an oversight: jsonb is compressed at rest and some deployments mandate base64 over an object-store URL. The live stream applies the same projection in `flushCatchup` unless `view=full`, but the browser deliberately never requests `full` there: streamed rows are ephemeral (finalize re-reads from the GET) and live tool cards render from `details`, which the slim view already carries.

---
