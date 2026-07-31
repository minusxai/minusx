# The orchestrator — the agent engine

The generic, app-agnostic agent runtime: the append-only conversation log, the step loop, the
server-vs-frontend tool tiers, parameter coercion, and the single LLM call site. It owns **no** app
concepts — no Files, Auth, Connections, Redux, or React.

Concrete agents and tools live in `frontend/agents/`; the per-turn wiring that selects and runs them
is `frontend/lib/chat/`. Both have their own `CLAUDE.md`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## `orchestrator/` — the engine

`orchestrator/types.ts` defines the whole contract in three types:

- **`MXTool<TParams, TContext, TDetails>`** — a leaf. `static schema: Tool<TSchema>` (name +
  description + a TypeBox `Type.Object` param schema) and one `async run(): Promise<ToolResponse>`.
  `ToolResponse` is `{ content, details?, isError }`; `content` is text/image blocks the LLM sees,
  `details` is the side channel the chat UI reads (never sent to the model).
- **`MXAgent`** extends `MXTool` — an agent IS a tool, which is why sub-agents dispatch through the
  same path as leaf tools. Adds `static model`, `static tools: Tool[]`, `static maxSteps`,
  `static callOptions`, `static llmAgent`, plus `threadHistory` / `toolThread` and the default
  agentic `run()` loop.
- **`AgentContext`** — deliberately an empty interface. Each agent family extends it
  (`BenchmarkAnalystContext` → `RemoteAnalystContext` → `MicroAgentContext` / `EvalAnalystContext` /
  `ReportAgentContext`). The engine never dereferences a context field; it passes the object through
  to constructors and copies it onto the root log entry.

`orchestrator/orchestrator.ts` is the engine. The conversation log is a flat array of
`ConversationLogEntry = (AgentInvocation | AssistantMessage | ToolResultMessage) & { parent_id }`.
Tree structure lives entirely in `parent_id`: the root invocation has `parent_id: null`, everything
an agent produces carries that agent's id. Sub-agents are found by scanning for the `toolCall` block
whose `id` matches (`findSubAgentToolCall`), so a saved log rehydrates into a live agent tree with
no separate index.

```
run(root) → log.push(root invocation, parent_id: null)
          → root.run() loop:
              llm() ──► Orchestrator.callLLM ──► streamSimple ──► events pushed to EventStream
              stopReason 'stop'  → done
              stopReason 'toolUse' → dispatch(msg, agent)
                   ├─ server tool  → run() → ToolResultMessage appended → loop continues
                   ├─ sub-agent    → instance.run() (recursive) → result wrapped as ToolResultMessage
                   └─ frontend tool→ throws UserInputException → 'pending' StreamEvent → run pauses
resume(completedToolResults) → append results → reconstructAgent(pausedId) → continue its loop
                             → bubble up through findCallingAgent chain
```

**Tool tiers.** A frontend-bridged tool's server-side `run()` is a one-line
`throw new UserInputException(this.id)` — the Node class is a pure declaration. `dispatch` catches
that, emits a `{ type: 'pending', id, name, parameters, context, parent_id }` stream event, and
rethrows so the run pauses. The browser executes it via `lib/tools/tool-handlers.ts` and the result
comes back through `resume()`. Server tools execute in-process and the loop never pauses.

**`orchestrator/llm/`** is the pi-ai isolation boundary — the only place in the app allowed to
import `@earendil-works/pi-ai`. `index.ts` **defines** the domain types (`Message`,
`AssistantMessage`, `ToolCall`, `ToolResultMessage`, `Context`, `Tool`, `Usage`,
`AssistantMessageEvent`) as our own rather than re-exporting pi's, aliases only the opaque handles
(`Model`, `Api`), and wraps the runtime (`getModel`, `streamSimple`, `EventStream`). It also owns
model-handle construction for non-registry endpoints (`buildCustomModel`, `buildRegistryModel`) and
the `LlmCallRecorder` hook — a dependency-inversion seam the app installs
(`orchestration-core.server.ts` calls `setLlmCallRecorder`) so the boundary itself has no DB
dependency. `retry.ts` is the pure single-call retry policy; `faux-matcher.ts` + `testing.ts` are
the deterministic-LLM test seam.

**`orchestrator/prompts/`** is a pure render engine (`prompt-loader.ts`: `{template.ref}` resolution
+ Python-style `{var}` substitution) over `prompts.yaml`, which is imported **natively** and inlined
at build time (`yaml-loader` for Turbopack/webpack via `next.config.ts`, `@rollup/plugin-yaml` for
Vitest) — no runtime filesystem read, so it survives the standalone Docker build. Skills are
`templates.skill_*` keys; `listSkills`/`getSkill` strip the prefix. `story-guidance.yaml` sits
alongside and is projected by `lib/data/story/story-templates.ts`.

`orchestrator/concurrency.ts` is a generic semaphore (used for the `MAX_LLM_CONCURRENCY` gate here
and `MAX_AGENTS_CONCURRENCY` in the benchmark runner). `orchestrator/utils.ts` holds
`coerceParameters` / `normalizeParameters` / `validateParameters` and `buildUserTurnContent` (the
single builder for a user turn's content blocks — used both for the current turn and for prior turns
rebuilt from the log, so attachments re-render identically).

## Registration

`REGISTRABLES` (in `lib/chat/orchestration-core.server.ts`, not in this tree) is the array the
`Orchestrator` constructor takes; it resolves a tool call by `schema.name`. Three derived variants:

- **`HEADLESS_REGISTRABLES`** = `REGISTRABLES` with `HEADLESS_TOOL_SWAPS` applied — swaps the
  frontend-bridged `ReadFiles` for the server one. Without the swap the bridged variant would
  throw `UserInputException` with no browser to answer it, hang as a dangling pending call, and get
  marked "interrupted" on the next turn.
- **`BENCHMARK_TOOL_SWAPS`** — swaps `ExecuteQuery`/`SearchDBSchema` for the V1-benchmark chained /
  catalog variants when the saved log's root is `BenchmarkAnalystAgent` or
  `DoubleCheckBenchmarkAgent`.
- **`V2_BENCHMARK_REGISTRABLES`** — a whole-array replacement (the V2 toolset has different names,
  so swap-by-name doesn't cover it). V1 and V2 double-check share the root name, so V2 is detected by
  scanning the log for `V2_AGENT_MARKERS` (`V2BenchmarkAnalystAgent`, `Explore`, `fetchHandle`).

**Registration rule:** any class the orchestrator must *instantiate* — root agents, sub-agents, and
every tool — must be in the registry, including legacy names that appear only in old logs
(`Screenshot` is registered but is in no agent's toolset).
