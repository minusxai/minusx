# The orchestrator — the agent engine

The generic, app-agnostic agent runtime: the append-only conversation log, the step loop, the
server-vs-frontend tool tiers, parameter coercion, and the single LLM call site. It owns **no** app
concepts — no Files, Auth, Connections, Redux, or React.

Concrete agents and tools live in `frontend/agents/`; the per-turn wiring that selects and runs them
is `frontend/lib/chat/`. Both have their own `CLAUDE.md`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## The contract

`orchestrator/types.ts` defines the whole contract in three types:

- **`MXTool<TParams, TContext, TDetails>`** — a leaf. `static schema: Tool<TSchema>` (name +
  description + a TypeBox `Type.Object` param schema) and one
  `async run(): Promise<ToolResponse<TDetails> | AssistantMessage>`. `ToolResponse` is
  `{ content, details?, isError }`; `content` is text/image blocks the LLM sees, `details` is the
  side channel the chat UI reads (never sent to the model). The `| AssistantMessage` arm of the
  return type is what lets an agent be a tool.
- **`MXAgent`** extends `MXTool` — an agent IS a tool, which is why sub-agents dispatch through the
  same path as leaf tools. Adds `static model`, `static tools: Tool[]`, `static maxSteps`,
  `static callOptions`, `static llmAgent`, plus `threadHistory` / `toolThread` and the default
  agentic `run()` loop. `static type` is `'Tool'` on `MXTool` and `'Agent'` on `MXAgent` — the only
  runtime discriminator, used by the registry filters in `lib/chat/`.
- **`AgentContext`** — deliberately an empty interface. Each agent family extends it
  (`BenchmarkAnalystContext` → `RemoteAnalystContext` → `MicroAgentContext` / `EvalAnalystContext` /
  `ReportAgentContext`). The engine never dereferences a context field; it passes the object through
  to constructors and copies it onto the root log entry.

## The step loop

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

`callLLM` is the **single LLM call site** for the whole app: the credit gate (`beforeLlmCall`), the
DB-backed model plan (`resolveLlmPlan`), the concurrency semaphore, prompt-cache retention, the
retry loop and the per-call analytics stamps (`_duration`, `_lllmCallId`, `_agent`, `_grade`) all
live there, so every agent, sub-agent and resume hop is covered by construction.

## The LLM boundary

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

## Prompts

**`orchestrator/prompts/`** is a pure render engine (`prompt-loader.ts`: `{template.ref}` resolution
+ Python-style `{var}` substitution) over `prompts.yaml`, which is imported **natively** and inlined
at build time (`yaml-loader` for Turbopack/webpack via `next.config.ts`, `@rollup/plugin-yaml` for
Vitest) — no runtime filesystem read, so it survives the standalone Docker build. Skills are
`templates.skill_*` keys; `listSkills`/`getSkill` strip the prefix. `story-guidance.yaml` sits
alongside and is projected by `lib/data/story/story-templates.ts`.

Agents must load skills through `agents/skill-content.ts`, never `getSkill` directly — see
`frontend/agents/CLAUDE.md`.

## Utilities

`orchestrator/concurrency.ts` is a generic semaphore (used for the `MAX_LLM_CONCURRENCY` gate here
and `MAX_AGENTS_CONCURRENCY` in the benchmark runner). `orchestrator/utils.ts` holds
`coerceParameters` / `normalizeParameters` / `validateParameters`, `synthErrorAssistantMessage`, and
`buildUserTurnContent` (the single builder for a user turn's content blocks — used both for the
current turn and for prior turns rebuilt from the log, so attachments re-render identically).

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

**The registry does not pick the root agent.** For a *new* turn the root class comes from
`ROOT_AGENT_BY_NAME` (a separate lookup keyed on `body.agent`, outranked by a resolved custom-agent
pointer); on *resume* the root is reconstructed from the saved log's invocation name through the
registry. A class therefore needs both entries to be startable and resumable. The selection rules
and their security rationale live in `frontend/lib/chat/CLAUDE.md`.

## Gotchas

- **The `Orchestrator` is single-use.** A `used` flag makes a second `run()`/`resume()` throw. Every
  turn constructs a fresh instance from the saved log.
- **`run()` calls `appendInterruptResultsForDanglers()`; `resume()` does not.** Starting a new turn
  converts any unresolved tool call into an `isError: true` "interrupted" tool result. A bridge
  result that arrives after the user has sent the next message is therefore already superseded.
- **`maxSteps` is two mechanisms.** `buildLLMContext()` withholds `tools` entirely once
  `toolThread.length >= maxSteps − 5`, forcing a final answer; the hard cap only produces the
  terminal `"Maximum iterations (N) reached."` reply. The default is `Infinity`, which makes the
  soft cap a no-op for agents that don't opt in. Per-agent values and the prompt-hint convention are
  in `frontend/agents/CLAUDE.md`.
- **Coercion happens before persistence.** `dispatch` runs `coerceToolCallArguments` *before*
  pushing to the log, so the stored log never contains the stringified-args shape models sometimes
  emit (`fileIds: "[2158]"`). Coercion is deliberately narrow: only a **string** value whose schema
  expects array/object/number/integer/boolean is `JSON.parse`d then `Convert`ed. A string-typed
  field is never parsed, unparseable JSON is left alone, and a genuinely wrong-typed arg still fails
  validation. Tool calls for unknown tools are left untouched.
- **Unknown tool and invalid params are recoverable, not fatal.** Both produce an `isError: true`
  `ToolResultMessage` (the unknown-tool text lists the parent agent's available tools) so the model
  self-corrects. Only `UserInputException` pauses a run; any other thrown error — from a leaf tool
  *or* from a sub-agent's whole run — also becomes an `isError` tool result. Deliberately: an
  unmatched tool call would otherwise make `getPendingToolCalls()` report a *server* tool as pending
  and the browser would try to bridge it.
- **Mixed completion is structural.** `dispatch` uses `Promise.allSettled`, records every finished
  tool result, and only then rethrows an aggregate `UserInputException` for the pending ids. Breaking
  early would lose completed work.
- **`stopReason: 'length'` fails the run immediately** (in `MXAgent.llm()`, the one choke point every
  loop — including custom ones like the eval agent's — passes through). Re-calling with the same
  context fails identically at full input cost. The message differentiates context exhaustion
  (output ≤ 64 tokens ⇒ the window is full) from an output-cap truncation.
- **Retries are per-call, not per-turn.** `callLLM` re-issues the same request up to
  `MAX_LLM_CALL_RETRIES` (2), only when the terminal event is `reason: 'error'`, the run isn't
  aborted, **nothing user-visible has streamed yet**, and the message matches the positive allowlist
  in `retry.ts`. A *silent* end (the iterator finishes with neither a `done` nor an `error` event)
  is routed through the same policy under a synthetic message. The terminal error event is *held*
  during the attempt loop so a successful re-issue supersedes it rather than latching the turn's
  first `runError`; a non-retried failure surfaces as a throw instead.
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

## The pi-ai dependency freeze and import rules

**The boundary's dependencies are version-frozen, and the freeze has drifted.**
`@earendil-works/pi-ai` and `typebox` are pinned to exact versions in `frontend/package.json` (no
caret) because `orchestrator/llm/` owns a seam against pi's *exact* shapes — the owned domain types
mirror pi's structurally so the wrappers can cast across the seam, and `tsc` over all consumers is
the only thing guarding that they stay sufficient. A floating minor would move the shapes underneath
the one module nothing else checks. The `typebox` pin exists for a second reason: it was chosen to
match the single copy pi resolves, so the two never disagree on `TSchema` (a dual-package hazard
produces two incompatible brands). That has since drifted — `@earendil-works/pi-ai@0.80.6` declares
`typebox@1.1.38` exactly while the app pins `1.1.37`, so npm installs a nested second copy under
`node_modules/@earendil-works/pi-ai/node_modules/typebox`. Two copies are installed today;
realigning the app pin to pi's declared version is what restores the intent.

**The carve-out consumes the `/compat` subpath, not the package root.** `orchestrator/llm/index.ts`
and `testing.ts` both import from `@earendil-works/pi-ai/compat` — a temporary entrypoint. That is
why `RESTRICT_PI_AI_SUBPATHS` (a `group` pattern) exists alongside the exact-specifier
`RESTRICT_PI_AI`: `name` blocks only the bare specifier, so without the pattern the ban would be
trivially bypassed by importing a subpath.

**Every `no-restricted-imports` override block must re-include `RESTRICT_PI_AI`.** Flat config
*replaces* the rule per matched file rather than merging, so a later override block that lists its
own restrictions and omits `RESTRICT_PI_AI` silently reopens the boundary for every file it matches
— no error, no warning. The sole intended exception is the `orchestrator/llm/**` carve-out.

**The positive import rules for everything outside the boundary:** LLM types *and* runtime from
`@/orchestrator/llm`; faux/test helpers from `@/orchestrator/llm/testing`; `Type` / `TSchema` /
`Static` directly from `typebox`. Never `@earendil-works/pi-ai` in any form. If the provider is ever
swapped, keep the swap single-homed — especially the faux helpers in `testing.ts`, which are thin
re-bindings of pi's and are the one place a mock-model replacement lands.

## Key files

| Task | File |
|---|---|
| Understand the step loop, dispatch, resume, log projection | `orchestrator/orchestrator.ts` |
| `MXTool` / `MXAgent` / `AgentContext` / `ToolResponse` contracts | `orchestrator/types.ts` |
| Add/inspect an LLM domain type, wrap a provider call, build a custom model handle | `orchestrator/llm/index.ts` |
| Change what counts as a retryable stream drop | `orchestrator/llm/retry.ts` |
| Write a deterministic LLM test | `orchestrator/llm/testing.ts`, `orchestrator/llm/faux-matcher.ts` |
| Edit a system prompt or a skill | `orchestrator/prompts/prompts.yaml` (+ `orchestrator/prompts/prompt-loader.ts` for the engine) |
| Fix arg coercion / validation / user-turn content assembly | `orchestrator/utils.ts` |
| Bound concurrent LLM calls or agent runs | `orchestrator/concurrency.ts` |
| Read the engine's behavioural spec | `agents/test-agent/__tests__/orchestrator-behaviors.test.ts` |
| Add/remove a registered tool or agent | `lib/chat/orchestration-core.server.ts` (not in this tree) |
