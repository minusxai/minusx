# Agents and tools

Every concrete agent and tool: prompt assembly, DB/file tool implementations, and the app-specific
`AgentContext` shapes — everything the engine deliberately refuses to know.

Read `frontend/orchestrator/CLAUDE.md` first for the `MXTool`/`MXAgent` contract these implement.

**The directory name `benchmark-analyst` is a historical misnomer.** It is not benchmark-only: it
holds `BenchmarkAnalystAgent`, the base class of the entire production analyst chain, and the DB
tools (`SearchDBSchema`, `ExecuteQuery`, `RunSemanticQuery`, `FuzzyMatch`) that every analyst turn
uses. `lib/chat/orchestration-core.server.ts` imports eight entry points from it. Only
`explore-dataset`, `submit-answer` and `v2/auto-context` are genuinely benchmark-only.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## `agents/` — agents and tools

The class hierarchy is real inheritance, not composition:

```
MXAgent
└─ BenchmarkAnalystAgent          DB tools only; no file system, no app state
   ├─ V2BenchmarkAnalystAgent     4 handle-based primitives (v2/)
   └─ RemoteAnalystAgent          + file tools + production prompts.yaml rendering
      ├─ WebAnalystAgent          + frontend-bridged tools (the browser root agent)
      │  ├─ OnboardingContextAgent / OnboardingDashboardAgent   restricted toolset, low maxSteps
      │  └─ RemoteSessionAgent    toolset minus ClarifyFrontend; run() never called
      ├─ SlackAgent               headless; adds ListDBConnections + slack_addendum
      ├─ EvalAnalystAgent         read-only tools + Submit* tools; custom run()
      └─ MicroAgent               no tools; one LLM call from a named prompt template
ReportAgent (extends MXAgent directly) — hand-rolled controller, dispatches one analyst sub-agent
```

**Base\* vs `*.server.ts`.** `agents/benchmark-analyst/db-tools.ts` is CLI-safe: no `server-only`
import, so `npm run benchmark:dab` can load it in a plain Node process. It defines
`BaseSearchDBSchema` / `BaseExecuteQuery`, which build `NodeConnector`s directly from
`ctx.connections[*].config` and expose two override hooks (`_initialiseConnectors`,
`_loadSchemaFallback` / `_executeFallback`). `db-tools.server.ts` imports `server-only` and
subclasses them: `_initialiseConnectors` becomes a no-op (production contexts carry metadata-only
connections) and the fallbacks route through `runQueryStream` + the shared durable query cache, and
`loadConnectionSchema`. **Both keep the same `schema.name`**, which is what makes the registry swap
work. `agents/analyst/file-tools.ts` (server `ReadFiles`/`SearchFiles`) and
`agents/web-analyst/web-tools.ts` (frontend-bridged `ReadFiles`) are the same trick at the file-tool
tier — one LLM-visible `ReadFiles`, two implementations.

**Skills.** `agents/analyst/skills.ts` maps page type → preloaded skills (`PAGE_SKILL_MAP`), builds
the `LoadSkill` catalog, and renders preloaded skill bodies. `agents/skill-content.ts` is the single
sanctioned skill loader: it augments the prompt tree with `SCHEMA_TEMPLATE_VARS` from
`lib/validation/atlas-json-schemas` so a skill's `{schema_question}` placeholder renders the **live**
TypeBox content schema. Never call `getSkill` from `prompt-loader` directly.

**Custom agents.** A custom agent is not a class. It is an `AgentEntry` (`lib/types/context.ts`)
stored on a Knowledge Base context's *content* — beside `skills` and `evals`, not inside a version —
authored in the context editor's Agents tab and inherited down the context tree as `fullAgents`
(`lib/data/loaders/context-loader-utils.ts`, nearest wins by name). The definition carries a persona
`prompt`, a `promptMode`, `preloadSkills` / `includeSkills`, an optional `gradeOverride` and
`enabled`. It changes nothing about *authority*: the turn still runs as the requesting user, so a
definition can never widen data access.

`agents/custom/custom-agent.ts` is the one registered class that serves every definition. It extends
`WebAnalystAgent` unchanged — same toolset, same `maxSteps` — and overrides only `getSystemPrompt()`.
The per-turn definition rides on `context.customAgent`, frozen into the saved root context, so a
mid-turn resume reconstructs the same behaviour from `REGISTRABLES` by schema name without re-reading
the context file. A **new user message** re-resolves it, so an edited definition applies from the next
message on. Registering a class per definition would instead make every saved log unresumable the
moment the user renamed or deleted an agent.

Selection is a server-resolved pointer, never a client-supplied class. The browser sends
`agent_args.custom_agent` = an `AgentEntry.name`; `resolveCustomAgentFromContext`
(`lib/chat/agent-args.server.ts`) looks it up in the resolved context, and the whole path is
fallback-not-fail — a missing, disabled or empty-prompt entry, or a context that fails to load at
all, degrades the turn to the default analyst with a `console.warn`. An agent deleted from under a
stale browser tab must not brick the chat.

Prompt assembly has two modes, and both substitute the author's prompt as a **value**, never through
`resolveTemplates`, so braces the author typed stay literal. `append` renders the normal
`default.system` with `{agent_persona}` filled. `replace` renders `custom_agent_replace.system`, which
drops `{intro}` and `{guidelines}` and keeps everything an author cannot hand-write and the tools
depend on: app structure, schema, context docs, tools, file-state schema, preloaded skills,
connection, home folder.

Skill exposure is exact, and this is the counterintuitive part. `resolveCustomAgentFromContext` always
emits `skillAllowlist = [...includeSkills, ...preloadSkills]`, so on the real server path it is never
`undefined`. A present allowlist means `getPreloadedSkillNames` runs with `includePageDefaults: false`,
so `PAGE_SKILL_MAP` contributes nothing and an agent that lists no skills is told "No additional
skills are available for this turn." A custom agent's skills are what its author chose, plus nothing.
The allowlist is enforced **twice** — the `LoadSkill` catalog omits non-allowed names, and
`LoadSkill.run()` returns an `isError` before resolving anything — because a model that never saw a
name can still guess it. `gradeOverride` is a **default**, not a lock: an explicit grade picked in the
composer always wins.

## Interactions with other areas

| Boundary | Direction | Contract |
|---|---|---|
| `lib/chat/orchestration-core.server.ts` | calls in | The registrables hub. Builds `REGISTRABLES` / `HEADLESS_REGISTRABLES`, picks the root agent class — a resolved `agent_args.custom_agent` pointer first, then `body.agent`, else `WebAnalystAgent` — assembles `RemoteAnalystContext` from server-resolved pointers, installs `beforeLlmCall` (credits) and `resolveLlmPlan` (DB model config), and calls `orch.run()` / `orch.resume()`. |
| `lib/chat/conversation-turn.server.ts`, `app/api/conversations/[id]/{turns,stream}` | calls in | The v3 turn runner. Consumes the `EventStream<StreamEvent, AssistantMessage \| null>` and persists the log diff. |
| `lib/integrations/slack/run-turn.server.ts` | calls in | Same `setupOrchestration` path in-process, `agent: 'SlackAgent'` (server-controlled, never client input) → headless registrables. |
| `lib/chat/run-report.server.ts`, `run-eval.server.ts`, `run-micro-task.server.ts`, `remote-session-engine.server.ts` | call in | Construct an `Orchestrator` directly, each with its own registry — no HTTP route involved. Report = `HEADLESS_REGISTRABLES + ReportAgent`; eval = its own `EVAL_REGISTRABLES`; micro = `[MicroAgent]`; remote session = `REGISTRABLES` filtered to `type !== 'Agent'` (an external driver may invoke leaf tools only, never start an LLM loop). |
| `lib/tools/tool-handlers.ts` + `lib/tools/handlers/*` | called by browser | The other half of every frontend-bridged tool. The TypeBox schema here and the handler there must stay in sync; `lib/tools/__tests__/tool-schema-sync.test.ts` parses each handler's source and fails if the handler reads an undeclared `args` key or the schema declares a key the handler never reads. |
| `lib/projection/messages.ts` | called by agents | `RemoteAnalystAgent.buildMessages()` tags the current user turn with `_appState`/`_currentTime`/`_viewport` and runs the whole array through `projectMessages`, which diffs repeated app/file state to `{unchanged:true}`. **Prior** turns are re-tagged by `projectRootThreadHistory` from the stored invocation context (`_appState`, `_currentTime` only — no `_viewport`), so they re-render byte-identically. |
| `lib/llm/llm-plan.server.ts`, `lib/llm/minusx-default.ts` | called by engine/agents | `resolveLlmPlan(selector)` returns `{ model, callOptions, grade }` per call; agents' `static model` is only the substrate under it (faux in tests, the MinusX gateway default otherwise — `agents/analyst/model-config.ts`). |
| `lib/chat/tool-inspector.server.ts`, `app/api/tools/schema/route.ts` | read the registry | Admin surfaces built from `REGISTRABLES`. The inspector rejects `MXAgent` subclasses — instantiating one and calling `run()` would start an LLM loop. |
| `lib/test/faux-llm-channel.server.ts` + `/api/test/faux` | drives the LLM | Playwright installs content-keyed matches on each agent's exported `fauxRegistration`. |
| `lib/data/story/story-templates.ts`, `lib/branding/story-template-options.ts` | read prompts | Import `orchestrator/prompts/story-guidance.yaml` directly. |
| `lib/data/conversations.server.ts`, `lib/chat-translator/`, `lib/convo-debug/` | read the log | Consume `ConversationLog` / `ConversationLogEntry` as the persisted wire shape. |

## Gotchas

- **The `Orchestrator` is single-use.** A `used` flag makes a second `run()`/`resume()` throw. Every
  turn constructs a fresh instance from the saved log.
- **`run()` calls `appendInterruptResultsForDanglers()`; `resume()` does not.** Starting a new turn
  converts any unresolved tool call into an `isError: true` "interrupted" tool result. A bridge
  result that arrives after the user has sent the next message is therefore already superseded.
- **`maxSteps` is two mechanisms.** `buildLLMContext()` withholds `tools` entirely once
  `toolThread.length >= maxSteps − 5`, forcing a final answer; the hard cap only produces the
  terminal `"Maximum iterations (N) reached."` reply. `RemoteAnalystAgent.maxSteps = 35`, so tools
  vanish at 30 and the prompt is told `max_steps: 30`. The default is `Infinity`, which makes the
  soft cap a no-op for agents that don't opt in. The prompt's `max_steps` is rendered by each
  agent's `getSystemPrompt`, so it can disagree with the real cap: `SlackAgent` hardcodes
  `max_steps: '40'` while inheriting `maxSteps = 35` from `RemoteAnalystAgent`.
- **Coercion happens before persistence.** `dispatch` runs `coerceToolCallArguments` *before*
  pushing to the log, so the stored log never contains the stringified-args shape models sometimes
  emit (`fileIds: "[2158]"`). Coercion is deliberately narrow: only a **string** value whose schema
  expects array/object/number/integer/boolean is `JSON.parse`d then `Convert`ed. A string-typed
  field is never parsed, and a genuinely wrong-typed arg still fails validation. Tool calls for
  unknown tools are left untouched.
- **Unknown tool and invalid params are recoverable, not fatal.** Both produce an `isError: true`
  `ToolResultMessage` (the unknown-tool text lists the parent agent's available tools) so the model
  self-corrects. Only `UserInputException` pauses a run; any other thrown error from a leaf tool also
  becomes an `isError` tool result — deliberately, because an unmatched tool call would otherwise
  make `getPendingToolCalls()` report a *server* tool as pending and the browser would try to bridge
  it.
- **Mixed completion is structural.** `dispatch` uses `Promise.allSettled`, records every finished
  tool result, and only then rethrows an aggregate `UserInputException` for the pending ids. Breaking
  early would lose completed work.
- **`stopReason: 'length'` fails the run immediately** (in `MXAgent.llm()`, the one choke point every
  loop — including custom ones like the eval agent's — passes through). Re-calling with the same
  context fails identically at full input cost. The message differentiates context exhaustion
  (output ≤ 64 tokens ⇒ the window is full) from an output-cap truncation.
- **Retries are per-call, not per-turn.** `callLLM` re-issues the same request up to
  `MAX_LLM_CALL_RETRIES` (2), only when the terminal event is `reason: 'error'`, the run isn't
  aborted, **nothing has streamed yet**, and the message matches the positive allowlist in
  `retry.ts`. The terminal error event is *held* during the attempt loop so a successful re-issue
  supersedes it rather than latching the turn's first `runError`.
- **`projectRootThreadHistory(excludeRootId)`.** On resume, the current turn's root invocation is
  already in the log (committed eagerly at turn start) *and* its entries come back via
  `collectToolThread`. Without the exclusion the whole current turn — user message included — renders
  twice in every post-resume LLM call.
- **`<CurrentTime>` is frozen at turn start** onto the root context (hour granularity) and replayed
  from the log for prior turns. Re-stamping it per projection would invalidate the provider prompt
  cache on every call.
- **Cache retention defaults to `'long'`** process-wide (`DEFAULT_CACHE_RETENTION` env, anything
  unrecognized ⇒ `'long'`) and is spread into `streamSimple` *before* `callOptions`, so an explicit
  `callOptions.cacheRetention` wins.
- **Plan options merge OVER agent options** in `callLLM` (`{...callOptions, ...plan.callOptions}`) —
  a per-turn option like web-search `userLocation` survives, but a conflicting key follows the DB
  config. A plan-model failure surfaces as the turn error; there is no silent fallback.
- **`llmSemaphore` is module-level**, so `MAX_LLM_CONCURRENCY` is a whole-process budget shared by
  every `Orchestrator` instance. Unset ⇒ a genuinely free no-op.
- **ESLint enforces both boundaries** (`frontend/eslint.config.mjs`): `orchestrator/**` may not
  import `@/lib/**`, `@/app/**`, `@/store/**`, `@/components/**`, or `@/agents/**` (tests exempt), and
  `@earendil-works/pi-ai` (plus its subpaths) is banned everywhere except `orchestrator/llm/**`,
  whose rule block must come *after* the `orchestrator/**` block to win under flat config.
- **Faux models can never reach production.** `getAgentModelOrTestFallback` returns the faux handle
  only under `NODE_ENV=test` / `VITEST` / `E2E_MODE`; otherwise the MinusX default. Agents must not
  reference their `fauxRegistration.getModel()` any other way.
- **`ClarifyFrontend`, not `Clarify`.** The LLM-visible name matches the frontend handler exactly;
  the orchestrator dispatches by exact name, so there is no spawn-wrapper tool.
- **`DeleteFile` is deliberately absent** — there is no `registerFrontendTool('DeleteFile', …)`
  handler, so advertising it would produce "Unknown client-side tool" at bridge time.

## Key files

| Task | File |
|---|---|
| Understand the step loop, dispatch, resume, log projection | `orchestrator/orchestrator.ts` |
| `MXTool` / `MXAgent` / `AgentContext` / `ToolResponse` contracts | `orchestrator/types.ts` |
| Add/inspect an LLM domain type, wrap a provider call, build a custom model handle | `orchestrator/llm/index.ts` |
| Change what counts as a retryable stream drop | `orchestrator/llm/retry.ts` |
| Write a deterministic LLM test | `orchestrator/llm/testing.ts`, `orchestrator/llm/faux-matcher.ts` |
| Edit a system prompt or a skill | `orchestrator/prompts/prompts.yaml` (+ `prompt-loader.ts` for the engine) |
| Fix arg coercion / validation / user-turn content assembly | `orchestrator/utils.ts` |
| Change the production analyst prompt or context wiring | `agents/analyst/analyst-agent.ts`, `agents/analyst/types.ts` |
| Change which skills preload for a page type | `agents/analyst/skills.ts` |
| Change how a user-defined agent's prompt is assembled | `agents/custom/custom-agent.ts` (+ `custom_agent_replace.system` in `prompts.yaml`) |
| Change how a custom-agent definition is resolved from a context | `lib/chat/agent-args.server.ts` (`resolveCustomAgentFromContext`) |
| Load a skill with live content schemas | `agents/skill-content.ts` |
| Add/modify a frontend-bridged tool schema | `agents/web-analyst/web-tools.ts` (pair with `lib/tools/handlers/*`) |
| Change the browser agent's toolset or call options | `agents/web-analyst/web-analyst.ts` |
| Change CLI-safe DB tool behaviour | `agents/benchmark-analyst/db-tools.ts` |
| Change production query/schema execution for the agent | `agents/benchmark-analyst/db-tools.server.ts` |
| Understand the benchmark context/connection shapes | `agents/benchmark-analyst/types.ts` |
| Work on the V2 handle/catalog benchmark stack | `agents/benchmark-analyst/v2/index.ts` (entry), `v2/v2-agent.ts`, `v2/handle-store.ts`, `v2/catalog.ts` |
| Change Slack's prompt/toolset | `agents/slack/slack-agent.ts` |
| Add a single-turn LLM use-case (title, summary, rubric judge) | `agents/micro/micro-tasks.ts` (+ `micro.<key>.{system,user}` in `prompts.yaml`) |
| Change the scheduled-report controller | `agents/report/report-agent.ts` |
| Read the engine's behavioural spec | `agents/test-agent/__tests__/orchestrator-behaviors.test.ts` |

**The boundary's dependencies are version-frozen, and the freeze has drifted.** `@earendil-works/pi-ai` and `typebox` are pinned to exact versions in `frontend/package.json` (no caret) because `orchestrator/llm/` owns a seam against pi's *exact* shapes — the owned domain types mirror pi's structurally so the wrappers can cast across the seam, and `tsc` over all consumers is the only thing guarding that they stay sufficient. A floating minor would move the shapes underneath the one module nothing else checks. The `typebox` pin exists for a second reason: it was chosen to match the single copy pi resolves, so the two never disagree on `TSchema` (a dual-package hazard produces two incompatible brands). That has since drifted — `@earendil-works/pi-ai@0.80.6` declares `typebox@1.1.38` exactly while the app pins `1.1.37`, so npm installs a nested second copy under `node_modules/@earendil-works/pi-ai/node_modules/typebox`. Two copies are installed today; realigning the app pin to pi's declared version is what restores the intent.

**The carve-out consumes the `/compat` subpath, not the package root.** `orchestrator/llm/index.ts` and `testing.ts` both import from `@earendil-works/pi-ai/compat` — a temporary entrypoint. That is why `RESTRICT_PI_AI_SUBPATHS` (a `group` pattern) exists alongside the exact-specifier `RESTRICT_PI_AI`: `name` blocks only the bare specifier, so without the pattern the ban would be trivially bypassed by importing a subpath.

**Every `no-restricted-imports` override block must re-include `RESTRICT_PI_AI`.** Flat config *replaces* the rule per matched file rather than merging, so a later override block that lists its own restrictions and omits `RESTRICT_PI_AI` silently reopens the boundary for every file it matches — no error, no warning. The sole intended exception is the `orchestrator/llm/**` carve-out.

**The positive import rules for everything outside the boundary:** LLM types *and* runtime from `@/orchestrator/llm`; faux/test helpers from `@/orchestrator/llm/testing`; `Type` / `TSchema` / `Static` directly from `typebox`. Never `@earendil-works/pi-ai` in any form. If the provider is ever swapped, keep the swap single-homed — especially the faux helpers in `testing.ts`, which are thin re-bindings of pi's and are the one place a mock-model replacement lands.

---
