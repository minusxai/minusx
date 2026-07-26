# frontend/agents

## What this module does

Every agent and tool reachable through the chat orchestrator. A file here declares **what the model is
told it can do** (`schema.name`, description, TypeBox param schema) and, for server-side tools, **what
actually happens** (`run()`). It owns the class hierarchy, the per-agent system prompts + skill
selection, and the agent context shapes.

It is not the *only* tool surface in the app: `lib/mcp/server.ts` registers a separate set
(`SearchDBSchema`, `ExecuteQuery`, `LoadContext`, …) for external MCP clients, declaring its own
schemas. Changing a schema here does not change MCP, though some implementation helpers are shared
(e.g. `loadContextDocsByKeys` backs both `LoadContext`s).

It does **not** own the execution engine (`frontend/orchestrator/` — loop, dispatch, log, resume, LLM
calls), the registries that decide which classes exist for a given conversation
(`lib/chat/orchestration-core.server.ts`), or the browser-side implementation of frontend-bridged tools
(`lib/tools/handlers/*.ts`). It also does not own model selection: `static model` is only a substrate;
the real model is resolved per call by `Orchestrator.resolveLlmPlan` from DB config.

## Architecture

**One class tree.** `MXTool` (a single `run()`) → `MXAgent` (adds the LLM loop: `llm()` → `dispatch()`
until `stopReason === 'stop'` or `maxSteps`). Both live in `frontend/orchestrator/types.ts`. Agents are
tools — a sub-agent is dispatched exactly like a tool call and its final text becomes the tool result.

```
MXAgent
├─ BenchmarkAnalystAgent           DB tools only; no filesystem, no app state
│   ├─ RemoteAnalystAgent          schema.name = 'AnalystAgent'; + file tools, prompts.yaml, projection
│   │   ├─ WebAnalystAgent         + frontend-bridged tools (the default browser-chat root)
│   │   │   ├─ OnboardingContextAgent / OnboardingDashboardAgent  fewer tools, lower maxSteps
│   │   │   └─ RemoteSessionAgent  toolset minus ClarifyFrontend; run() never called
│   │   ├─ SlackAgent              headless; slack_addendum prompt, PAGE_SKILL_MAP['slack']
│   │   ├─ MicroAgent              tools = []; one LLM call for a named task
│   │   └─ EvalAnalystAgent        schema.name = 'TestAgent'; stops on first Submit* result
│   └─ V2BenchmarkAnalystAgent     4 handle-based primitives (agents/benchmark-analyst/v2/)
├─ AutoContextAgent                lighter model; annotates a dataset's catalog before the run
└─ ReportAgent, DoubleCheckBenchmarkAgent (→ V2DoubleCheckBenchmarkAgent)   hand-rolled run()
```

**Tool contract.** A tool is an `MXTool` subclass with `static readonly schema = { name, description,
parameters }` where `parameters` is a TypeBox `Type.Object`. That schema is the *only* thing the model
learns about the tool, and the orchestrator coerces incoming args to it before `run()`. Three execution
shapes:
- **server tool** — `run()` does the work in-process (`file-tools.ts`, `health-tools.ts`, `db-tools*.ts`,
  `LoadContext`).
- **frontend-bridged tool** — `run()` is one line: `throw new UserInputException(this.id)`. The
  orchestrator emits a `pending` event, the browser executes the real handler in `lib/tools/handlers/`,
  and the turn resumes. All of `web-tools.ts` except `LoadContext` (and `LoadSkill`, which is a hybrid:
  system skills resolve server-side, unknown-but-catalogued names bridge).
- **hand-rolled controller** — an `MXAgent` with `tools = []` whose `run()` dispatches sub-agents into
  deterministic slot ids so a crashed run resumes from the last completed slot
  (`benchmark-analyst/double-check-benchmark.ts`, `report/report-agent.ts`).

**Registration is about reconstruction, not just dispatch.** The orchestrator instantiates classes from
a registrable array by `schema.name` — both to run a new tool call and to rebuild a saved conversation
(`reconstructAgent`). A class missing from the registry makes old logs unloadable, not just new calls
fail. `setupOrchestration` picks one of **four** arrays per conversation — and the three selectors are
each different, which is the easy thing to get wrong:

```
V2 benchmark      → V2_BENCHMARK_REGISTRABLES   (whole array replaced: V2_DATA_TOOLS + agents)
V1 benchmark      → withSwaps(REGISTRABLES, BENCHMARK_TOOL_SWAPS)
Slack             → HEADLESS_REGISTRABLES        (ReadFiles → server-side variant)
everything else   → REGISTRABLES
```
- *benchmark* is the saved log's **root invocation name** (`BenchmarkAnalystAgent` or
  `DoubleCheckBenchmarkAgent`).
- *V2 vs V1* is **not** readable from the root — both double-check agents inherit
  `schema.name = 'DoubleCheckBenchmarkAgent'`. `isV2BenchmarkConversation` scans the **whole log** for a
  V2-only marker name (`V2BenchmarkAnalystAgent`, `Explore`, `fetchHandle`).
- *Slack* is `body.agent === 'SlackAgent'` **or** the log root — the request field is server-controlled
  and carried on every Slack turn; the root check is the resume-path fallback.

`BENCHMARK_TOOL_SWAPS` substitutes `ChainedExecuteQuery` / `CatalogSearchDBSchema` for the production
`ExecuteQuery` / `SearchDBSchema`. Those are *not* `Base*` subclasses — they extend `MXTool` directly and
merely reuse the same `schema.name`, which is the whole basis of the positional swap.

`HEADLESS_REGISTRABLES` is *derived* from `REGISTRABLES`, so a new server tool lands in both
automatically — you only touch the swap maps when a tool needs a browser.

**`Base*` vs `.server.ts` is a module boundary, not the swap mechanism.** `db-tools.ts` holds
`BaseExecuteQuery` / `BaseSearchDBSchema`, which build `NodeConnector`s directly from
`ctx.connections[*].config`. `db-tools.server.ts` subclasses them, no-ops `_initialiseConnectors`, and
routes through the production seams (durable query cache, `loadConnectionSchema`). These two are never
substituted for each other — the split just keeps the NextAuth-importing production module off the
plain-Node benchmark CLI's import graph. **The `import 'server-only'` marker is not what enforces
that**: `benchmark:dab` runs `tsx --conditions react-server`, under which `server-only` resolves to an
empty module. The boundary holds only because the CLI never imports `db-tools.server.ts` — nothing
enforces it, so an accidental import surfaces as a NextAuth load failure at CLI startup.

**Skills** are prompt fragments in `orchestrator/prompts/prompts.yaml`. `analyst/skills.ts` preloads a
set into the system prompt from `PAGE_SKILL_MAP[pageType]` (+ user-selected + a navigation skill) and
advertises the rest as a `LoadSkill` catalog. All skill reads go through `agents/skill-content.ts`,
because it is the only place allowed to inject the live Atlas content schemas — `orchestrator/` is
banned from importing `@/lib/**` by an ESLint `no-restricted-imports` rule in `eslint.config.mjs`.

**Benchmark code lives in four places** and none of them is visible from the others:

| Where | Owns |
|---|---|
| `agents/benchmark-analyst/` | agents, tools, catalog/handle/auto-context machinery, shared DuckDB |
| `benchmarks/runner.ts`, `benchmarks/dataanalystbench.ts` | the `npm run benchmark:dab` CLI: dataset discovery, concurrency, JSONL in/out |
| `lib/benchmark/import-conversation.ts` + `app/api/benchmark/import/route.ts` | JSONL run → resumable chat conversation (stores configs on `meta.benchmark_connections`) |
| `app/benchmark/page.tsx` | the local viewer: drop a results JSONL, inspect runs, open one as a conversation |

## Gotchas

- **`schema.name` is not the class name, and it is the identity.** `RemoteAnalystAgent` →
  `'AnalystAgent'`; `EvalAnalystAgent` → `'TestAgent'` (nothing to do with `agents/test-agent/`, which
  is orchestrator-test fixtures). Renaming a class is free; renaming `schema.name` orphans every saved
  log that contains it.
- **A frontend-bridged tool with no handler is a runtime error, not a compile error.** Advertising a
  tool whose `schema.name` has no `registerFrontendTool` entry in `lib/tools/tool-handlers.ts` throws
  `Unknown client-side tool: <name>` mid-turn. Nothing type-checks that link, and
  `lib/tools/__tests__/tool-schema-sync.test.ts` does **not** cover it — that test audits schema⇄handler
  *argument* drift (every `args` key the handler reads is declared; every schema property is actually
  read) over a hand-maintained `BRIDGED_TOOLS` list. A new bridged tool you forget to add to that list
  is simply never audited.
- **`Screenshot` is registered but in no toolset** — a legacy alias of `ReviewFile` kept solely so old
  logs resume. Same category: `web-analyst/__tests__/tool-parity.test.ts` pins `WebAnalystAgent.tools`
  exactly, so adding or dropping a tool there fails until the expected list is updated deliberately.
- **`MXAgent.llm()` throws on `stopReason === 'length'`.** Retrying a truncated response burns full
  input cost for an identical failure, so the run fails fast. It is guarded at that one choke point, so
  custom loops (eval, controllers) inherit it — do not bypass `llm()`.
- **Tools are withheld at `toolThread.length >= maxSteps - 5`**, forcing a final answer. `MXAgent`'s
  default `maxSteps` is `Infinity`, so a finite cap is opt-in (`RemoteAnalystAgent` 35, onboarding
  15/25). Each agent renders its own `max_steps` prompt var, and they disagree: `RemoteAnalystAgent`
  passes `maxSteps - 5` to match the withholding point, the onboarding agents pass raw `maxSteps`.
- **Mixed dispatch records completions before pausing.** `Orchestrator.dispatch` pushes every completed
  tool result to the log inside `Promise.allSettled`, then aggregates pending ids into one
  `UserInputException` at the end. A server tool that throws a *real* error is converted to an
  `isError: true` tool result rather than propagating — only `UserInputException` pauses the run.
- **`ConnectionInfo.config` can carry credentials** (Postgres passwords, service-account JSON) and is
  serialized into the conversation log on benchmark paths. `publicConnectionMetadata` (`benchmark-analyst/types.ts`)
  is what strips it before anything reaches the LLM; use it, never the raw list.
- **The benchmark tree keeps process-global state.** One shared DuckDB instance with cumulative ATTACHes
  (`shared-duckdb.ts`), a process-wide handle map (`v2/handle-store.ts`), a catalog store keyed by
  `catalogKey`, and a `schemaCache` keyed by bare connection name in `db-tools.ts`. Hence
  `context.datasetKey` (namespaces ATTACH aliases so two datasets can both have a `metadata_database`)
  and `context.catalogKey` (`agent-a`/`agent-b` see deliberately different sample rows). Reusing a
  connection name across datasets without `datasetKey` silently cross-contaminates.
- **Faux models are the test substrate and must stay unreachable in production.** An agent module calls
  `registerFauxProvider`, then passes the faux model into a `*OrTestFallback` helper
  (`getAgentModelOrTestFallback` in `analyst/model-config.ts`, `getMicroModelOrTestFallback` in
  `micro/model-config.ts`). Route every faux reference through one of those helpers — they are what
  runtime-guards the substitution on `isTestEnv() || E2E_MODE`. Tests drive
  agents via `fauxRegistration.setResponses([...])`; agents reply with `stopReason: 'stop'` + plain
  content (there is no `TalkToUser` tool in this module — mocking one will not resolve).
- **Tests here run in the `orchestrator` Vitest project, not `node`** (`vitest.config.ts` excludes
  `agents/**` from `node`). Use `npm run test:orchestrator`. The `*/__tests__/real-llm.test.ts` files
  hit a real provider and self-skip unless `RUN_REAL_LLM=1`.

## Code pointers

| Task | File |
|---|---|
| `MXTool` / `MXAgent` contracts, `UserInputException`, `AgentContext` | `frontend/orchestrator/types.ts` |
| Loop, dispatch, resume, registry lookup by `schema.name` | `frontend/orchestrator/orchestrator.ts` |
| Register a tool/agent; pick registrables per conversation | `frontend/lib/chat/orchestration-core.server.ts` |
| Production system prompt, app-state projection | `frontend/agents/analyst/analyst-agent.ts` |
| Agent context fields (what the server resolves for a turn) | `frontend/agents/analyst/types.ts`, `frontend/lib/chat/agent-args.server.ts` |
| Skill preload / catalog logic | `frontend/agents/analyst/skills.ts`, `frontend/agents/skill-content.ts` |
| Add a browser-executed tool (schema side) | `frontend/agents/web-analyst/web-tools.ts` (+ handler in `frontend/lib/tools/handlers/`) |
| Add a server tool needing the document DB | `frontend/agents/analyst/file-tools.ts`, `frontend/agents/analyst/health-tools.ts` |
| SQL/schema/semantic tools — CLI-safe base vs production | `frontend/agents/benchmark-analyst/db-tools.ts` / `db-tools.server.ts` |
| V2 benchmark primitives + handles | `frontend/agents/benchmark-analyst/v2/index.ts` |
| Auto-generated dataset context | `frontend/agents/benchmark-analyst/v2/auto-context/auto-context.ts` |
| Add a single-shot LLM use-case (no new class) | `frontend/agents/micro/micro-tasks.ts` (+ `frontend/lib/chat/run-micro-task.server.ts`) |
| Headless entry points | `run-report.server.ts`, `run-eval.server.ts`, `remote-session-engine.server.ts` (all in `frontend/lib/chat/`), `frontend/lib/integrations/slack/process-event.ts` |
| Benchmark CLI | `frontend/benchmarks/dataanalystbench.ts`, `frontend/benchmarks/runner.ts` |
| Declarative agent test specs | `frontend/agents/analyst/__tests__/specs/analyst.faux.json` + `frontend/orchestrator/__tests__/support/test-spec-runner.ts` |
