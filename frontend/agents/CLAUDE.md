# Agents and tools

Every concrete agent and tool: prompt assembly, DB/file tool implementations, and the app-specific
`AgentContext` shapes — everything the engine deliberately refuses to know.

**Read `frontend/orchestrator/CLAUDE.md` first.** It owns the `MXTool`/`MXAgent` contract every
class here implements, the step loop that runs them, the registration rule, and the engine gotchas
(single-use orchestrator, arg coercion, retries, prompt-cache freezing). This doc assumes it.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## The class hierarchy

Real inheritance, not composition:

```
MXAgent
└─ BenchmarkAnalystAgent          DB tools only; no file system, no app state; prompt is a
   │                              template literal in the class, not prompts.yaml
   ├─ V2BenchmarkAnalystAgent     handle-based primitives (v2/)
   └─ RemoteAnalystAgent          + file tools + production prompts.yaml rendering
      ├─ WebAnalystAgent          + frontend-bridged tools (the browser root agent)
      │  ├─ CustomAgent           same toolset; overrides getSystemPrompt() only
      │  ├─ OnboardingContextAgent / OnboardingDashboardAgent   restricted toolset, low maxSteps
      │  └─ RemoteSessionAgent    toolset minus ClarifyFrontend; run() never called
      ├─ SlackAgent               headless; inherits RemoteAnalystAgent's toolset, adds slack_addendum
      ├─ EvalAnalystAgent         read-only tools + Submit* tools; custom run()
      └─ MicroAgent               no tools; one LLM call from a named prompt template
ReportAgent (extends MXAgent directly) — hand-rolled controller, dispatches one analyst sub-agent
```

`WebAnalystAgent` **drops** `ListDBConnections` (the browser turn always has a resolved connection);
`SlackAgent` keeps it by inheriting `RemoteAnalystAgent.tools`, because a Slack thread often has
several connections and none selected. `WebAnalystAgent` is also the only one that advertises
`FuzzyMatch` and `CheckFileHealth`.

**The directory name `benchmark-analyst` is a historical misnomer** — it holds the base class of the
production analyst chain. Production turns depend on four modules there: `benchmark-analyst.ts` (the
base class), `db-tools.ts` (`ListDBConnections` + the CLI-safe `Base*` pair), `db-tools.server.ts`
(the production `SearchDBSchema` / `ExecuteQuery` / `FuzzyMatch` / `RunSemanticQuery`) and `types.ts`
(`BenchmarkAnalystContext`, the root of the context chain). `lib/chat/orchestration-core.server.ts`
imports eight distinct entry points from the directory.

Everything else there is benchmark-only: `explore-dataset.ts`, `submit-answer.ts`,
`double-check-benchmark.ts`, `shared-duckdb.ts`, `connection-source.ts`, the
`CatalogSearchDBSchema` / `ChainedExecuteQuery` pair inside `db-tools.ts`, and the whole `v2/` tree.
Several are still in `REGISTRABLES` so old benchmark conversations resume in chat, and the base
class imports the V1 tool classes plus `v2/dialect-hints.ts` and `v2/fetch-handle.ts` for its own
toolset — so "benchmark-only" means *never reached by a production turn*, not *unimported*.

## Base\* vs `*.server.ts`

`agents/benchmark-analyst/db-tools.ts` is CLI-safe: no `server-only` import, so
`npm run benchmark:dab` can load it in a plain Node process. It defines `BaseSearchDBSchema` /
`BaseExecuteQuery`, which build `NodeConnector`s directly from `ctx.connections[*].config` and
expose override hooks (`_initialiseConnectors` plus `_loadSchemaFallback` / `_executeFallback`).
`db-tools.server.ts` imports `server-only` and subclasses them: `_initialiseConnectors` becomes a
no-op (production contexts carry metadata-only connections) and the fallbacks route through
`runQueryStream` + the shared durable query cache, and `loadConnectionSchema`. **Both keep the same
`schema.name`**, which is what makes the registry swap work — the production `ExecuteQuery` even
overrides `static schema` to drop the `timeout` param it cannot honour, keeping the name unchanged.
`agents/analyst/file-tools.ts` (server `ReadFiles`/`SearchFiles`) and
`agents/web-analyst/web-tools.ts` (frontend-bridged `ReadFiles`) are the same trick at the file-tool
tier — one LLM-visible `ReadFiles`, two implementations.

## Skills

`agents/analyst/skills.ts` maps page type → preloaded skills (`PAGE_SKILL_MAP`), builds the
`LoadSkill` catalog (`buildSkillsCatalog`, which takes the optional custom-agent `allowlist`), and
renders preloaded skill bodies. `agents/skill-content.ts` is the single sanctioned skill loader: it
augments the prompt tree with `SCHEMA_TEMPLATE_VARS` from `lib/validation/atlas-json-schemas` so a
skill's `{schema_question}` placeholder renders the **live** TypeBox content schema. Never call
`getSkill` from `prompt-loader` directly.

`LoadSkill` resolves system skills server-side, then a user-defined Knowledge Base skill whose body
the server-built catalog already carries, and only bridges to the browser for a catalog name it
could not resolve — which is why the headless paths (Slack, reports, cron) still work. A name that
matches neither fails fast *with the valid names* rather than spending a browser round-trip.

## Custom agents

A custom agent is not a class. It is an `AgentEntry` (`lib/types/context.ts`) stored on a Knowledge
Base context's *content* — beside `skills` and `evals`, not inside a version — authored in the
context editor's Agents tab and inherited down the context tree as `fullAgents`
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
all, degrades the turn to the default analyst (`setupOrchestration` logs the `console.warn`). An
agent deleted from under a stale browser tab must not brick the chat.

Prompt assembly has two modes, and both substitute the author's prompt as a **value**, never through
`resolveTemplates`, so braces the author typed stay literal. `append` renders the normal
`default.system` with `{agent_persona}` filled. `replace` renders `custom_agent_replace.system`, which
drops `{intro}` and `{guidelines}` and keeps everything an author cannot hand-write and the tools
depend on: app structure, schema, context docs, tools, file-state schema, preloaded skills,
connection, home folder.

Skill exposure is exact, and this is the counterintuitive part. `resolveCustomAgentFromContext` always
emits `skillAllowlist` = the de-duplicated union of `includeSkills` and `preloadSkills`, so on the
real server path it is never `undefined`. A present allowlist means `getPreloadedSkillNames` runs with
`includePageDefaults: false`, so `PAGE_SKILL_MAP` contributes nothing and an agent that lists no
skills is told "No additional skills are available for this turn." A custom agent's skills are what
its author chose, plus nothing. The allowlist is enforced **twice** — the `LoadSkill` catalog omits
non-allowed names, and `LoadSkill.run()` returns an `isError` before resolving anything — because a
model that never saw a name can still guess it. `gradeOverride` is a **default**, not a lock: an
explicit grade picked in the composer always wins.

## Interactions with other areas

| Boundary | Direction | Contract |
|---|---|---|
| `lib/chat/orchestration-core.server.ts` | calls in | The registrables hub. Builds `REGISTRABLES` / `HEADLESS_REGISTRABLES`, picks the root agent class — a resolved `agent_args.custom_agent` pointer first, then `body.agent`, else `WebAnalystAgent` — assembles `RemoteAnalystContext` from server-resolved pointers, installs `beforeLlmCall` (credits) and `resolveLlmPlan` (DB model config), and calls `orch.run()` / `orch.resume()`. |
| `lib/chat/conversation-turn.server.ts`, `app/api/conversations/[id]/turns/route.ts`, `app/api/conversations/[id]/stream/route.ts` | calls in | The v3 turn runner. Consumes the `EventStream<StreamEvent, AssistantMessage \| null>` and persists the log diff. |
| `lib/integrations/slack/run-turn.server.ts` | calls in | Same `setupOrchestration` path in-process, `agent: 'SlackAgent'` (server-controlled, never client input) → headless registrables. |
| `lib/chat/run-report.server.ts`, `lib/chat/run-eval.server.ts`, `lib/chat/run-micro-task.server.ts`, `lib/chat/remote-session-engine.server.ts` | call in | Construct an `Orchestrator` directly, each with its own registry — no HTTP route involved. Report = `HEADLESS_REGISTRABLES + ReportAgent + RemoteAnalystAgent`; eval = its own `EVAL_REGISTRABLES`; micro = `[MicroAgent]`; remote session = `REGISTRABLES` filtered to `type !== 'Agent'` **plus** `RemoteSessionAgent` (an external driver may invoke leaf tools only, but the session root must still be reconstructable as dispatch's parent). |
| `lib/tools/tool-handlers.ts` + `lib/tools/handlers/*` | called by browser | The other half of every frontend-bridged tool. The TypeBox schema here and the handler there must stay in sync; `lib/tools/__tests__/tool-schema-sync.test.ts` parses each handler's source and fails if the handler reads an undeclared `args` key or the schema declares a key the handler never reads. |
| `lib/projection/messages.ts` | called by agents | `RemoteAnalystAgent.buildMessages()` tags the current user turn with `_appState`/`_currentTime`/`_viewport` and runs the whole array through `projectMessages`, which diffs repeated app/file state to `{unchanged:true}`. **Prior** turns are re-tagged by `projectRootThreadHistory` from the stored invocation context (`_appState`, `_currentTime` only — no `_viewport`), so they re-render byte-identically. |
| `lib/llm/llm-plan.server.ts`, `lib/llm/minusx-default.ts` | called by engine/agents | `resolveLlmPlan(selector)` returns `{ model, callOptions, grade }` per call; agents' `static model` is only the substrate under it (faux in tests, the MinusX gateway default otherwise — `agents/analyst/model-config.ts`). A class's `static llmAgent` is the selector key (`web-analyst`, `slack`, `micro`, `report`, default `analyst`). |
| `lib/chat/tool-inspector.server.ts`, `app/api/tools/schema/route.ts` | read the registry | Admin surfaces built from `REGISTRABLES`. The inspector rejects anything whose `static type === 'Agent'` — instantiating one and calling `run()` would start an LLM loop. |
| `lib/test/faux-llm-channel.server.ts` + `app/api/test/faux/route.ts` | drives the LLM | Playwright installs content-keyed matches on each agent's exported `fauxRegistration`. A new chat-reachable agent must be added to its `DEFAULT_TARGETS` or its calls run unfauxed. |
| `lib/data/conversations.server.ts`, `lib/chat-translator/`, `lib/convo-debug/` | read the log | Consume `ConversationLog` / `ConversationLogEntry` as the persisted wire shape. |

## Gotchas

- **A class's name is not its `schema.name`, and the registry keys on `schema.name`.**
  `RemoteAnalystAgent` registers as `'AnalystAgent'` and `EvalAnalystAgent` as `'TestAgent'`. Saved
  logs, `ROOT_AGENT_BY_NAME`, the tool swaps and `V2_AGENT_MARKERS` all speak schema names; renaming
  a class is free, renaming its `schema.name` orphans every saved log that contains it.
- **`maxSteps` is a hard cap; the prompt hint is rendered separately and can disagree.**
  `RemoteAnalystAgent.maxSteps = 35` and its prompt renders `max_steps: String(ctor.maxSteps − 5)`
  = 30, which matches the engine's soft cap (tools are withheld at 30). `SlackAgent` derives the
  same way. The onboarding agents do **not**: `maxSteps` 15 / 25 with `max_steps: String(ctor.maxSteps)`,
  so the model is told 15/25 while tools actually vanish at 10/20. Keep the hint derived, never a
  literal.
- **Faux models can never reach production.** `getAgentModelOrTestFallback` returns the faux handle
  only under `NODE_ENV=test` / `VITEST` / `E2E_MODE`; otherwise the MinusX default. Agents must not
  reference their `fauxRegistration.getModel()` any other way.
- **`ClarifyFrontend`, not `Clarify`.** The LLM-visible name matches the frontend handler exactly;
  the orchestrator dispatches by exact name, so there is no spawn-wrapper tool.
- **`DeleteFile` is deliberately absent** — there is no `registerFrontendTool('DeleteFile', …)`
  handler, so advertising it would produce "Unknown client-side tool" at bridge time.
- **`Screenshot` is a legacy alias of `ReviewFile`** — exported and registered so old logs resolve,
  but in no agent's toolset. Don't add it back.
- **Subclassing an agent inherits its `static tools` array wholesale.** `MicroAgent` extends
  `RemoteAnalystAgent` and must blank it (`static tools = []`) to get a tool-free loop;
  `RemoteSessionAgent` filters the inherited array rather than restating it. Only a class extending
  `MXAgent` directly (`ReportAgent`) starts empty.

## Key files

| Task | File |
|---|---|
| Change the production analyst prompt or context wiring | `agents/analyst/analyst-agent.ts`, `agents/analyst/types.ts` |
| Change which skills preload for a page type | `agents/analyst/skills.ts` |
| Load a skill with live content schemas | `agents/skill-content.ts` |
| Change how a user-defined agent's prompt is assembled | `agents/custom/custom-agent.ts` (+ `custom_agent_replace.system` in `orchestrator/prompts/prompts.yaml`) |
| Change how a custom-agent definition is resolved from a context | `lib/chat/agent-args.server.ts` (`resolveCustomAgentFromContext`) |
| Add/modify a frontend-bridged tool schema | `agents/web-analyst/web-tools.ts` (pair with `lib/tools/handlers/`) |
| Change the browser agent's toolset or call options | `agents/web-analyst/web-analyst.ts` |
| Change CLI-safe DB tool behaviour | `agents/benchmark-analyst/db-tools.ts` |
| Change production query/schema execution for the agent | `agents/benchmark-analyst/db-tools.server.ts` |
| Understand the benchmark context/connection shapes | `agents/benchmark-analyst/types.ts` |
| Work on the V2 handle/catalog benchmark stack | `agents/benchmark-analyst/v2/index.ts` (entry), `agents/benchmark-analyst/v2/v2-agent.ts`, `agents/benchmark-analyst/v2/handle-store.ts`, `agents/benchmark-analyst/v2/catalog.ts` |
| Change Slack's prompt/toolset | `agents/slack/slack-agent.ts` |
| Add a single-turn LLM use-case (title, summary, rubric judge) | `agents/micro/micro-tasks.ts` (+ `micro.<key>.{system,user}` in `orchestrator/prompts/prompts.yaml`) |
| Change the scheduled-report controller | `agents/report/report-agent.ts` |
| Change the eval runner's loop or Submit tools | `agents/eval/eval-agent.ts`, `agents/eval/submit-tools.ts` |
