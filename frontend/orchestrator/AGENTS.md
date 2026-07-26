# frontend/orchestrator — the agent engine

## What this module does

`Orchestrator` is a **single-use** engine that drives one agent turn over an **append-only conversation
log**, plus the three pillars it needs: the LLM boundary (`llm/`), the prompt render engine
(`prompts/`), and a semaphore primitive (`concurrency.ts`). It owns the agentic loop, tool
dispatch/validation/coercion, the pause-resume protocol, projection of the log into an LLM context, and
transient single-call retry.

It owns **nothing app-specific** — no files, auth, connections, Redux, DB, chat routes, or agent
definitions. Those live in `frontend/agents/**` and `frontend/lib/**` and reach the engine through
`AgentContext` (an empty interface; agents extend it with whatever their tools need) and a few injected
hooks. An ESLint block over `orchestrator/**` (`frontend/eslint.config.mjs`) bans imports from
`@/lib/**`, `@/app/**`, `@/store/**`, `@/components/**`, `@/agents/**`; `orchestrator/**/__tests__/**` is
exempt so the engine's own tests can pull app-side fixtures and modules (`@/agents/test-agent`,
`@/agents/skill-content`, `@/lib/validation/atlas-json-schemas`). A later block re-declares the rule for
`orchestrator/llm/**` and — flat config being last-match-wins — *replaces* it there with the DocumentDB +
adapter-factory bans only, which is how `llm/` gets its pi-ai carve-out. That ordering is load-bearing:
hoist the `llm/**` block above the `orchestrator/**` one and the app-agnostic boundary silently stops
being enforced.

## Architecture

```
app layer (frontend/lib/chat/orchestration-core.server.ts)
  new Orchestrator(registrables, [...savedLog])      ← FRESH instance every turn
  orch.beforeLlmCall / resolveLlmPlan                 ← injected hooks (dependency inversion)
  orch.onActivity                                     ← observability hook; chat does NOT set it,
                                                        batch callers do (benchmarks/runner.ts)
        │                                    │
   run(rootAgent)                     resume(toolResults)
   push root invocation                append results, group by paused agent,
   (parent_id: null)                   reconstructAgent(id) from the log
        └──────────► MXAgent.run() loop ◄──────┘
              llm() → Orchestrator.callLLM → llm/streamSimple → provider
                stopReason 'stop'  → final AssistantMessage, loop ends
                otherwise          → Orchestrator.dispatch(msg, agent)
                     ├─ server tool  → execute in-process → toolResult appended
                     ├─ frontend tool→ UserInputException → push 'pending' event, pause
                     └─ sub-agent    → nested run(); reply wrapped as a toolResult
                                       under the CALLING agent
```

**The log.** `ConversationLog` is a flat array of `(AgentInvocation | AssistantMessage |
ToolResultMessage) & { parent_id }` (root invocation = `parent_id: null`). The agent tree is *not* stored
— it is re-derived by scanning (`findRootInvocation`, `findSubAgentToolCall`, `collectToolThread`,
`contextForAgent`, `reconstructAgent`). That is what makes the engine stateless across turns: each
turn/resume constructs a new `Orchestrator` over the saved log. The engine has **no concurrency guard of
its own**; the app supplies optimistic concurrency via `expectedLogIndex = savedLog.length` in
`frontend/lib/chat/orchestration-core.server.ts`.

**Context projection.** An agent's LLM context is `threadHistory` (prior turns, projected from the log by
`projectRootThreadHistory`) + the current user message + `toolThread` (this turn's live entries). Prior
root invocations are re-rendered as user messages, re-attaching their stored `attachments`
(`buildUserTurnContent` in `utils.ts` is the single builder for both current and prior turns) and carrying
non-wire `_appState`/`_currentTime` fields that the app's projection pass (`lib/projection/messages.ts`)
renders and diffs — so unchanged app state collapses across turns and the prompt prefix stays byte-stable
for provider caching.

**Tool tiers.** `dispatch` looks each tool call up in `registrables` by `schema.name`, coerces + validates
args, and instantiates. Server tools resolve in-process. Frontend-bridged tools throw
`UserInputException`: dispatch emits a `pending` stream event **at the source**, gathers every pending id,
and rethrows one aggregate UIE, which `run()` swallows and ends the stream with a `null` result. The app
then calls `getPendingToolCalls()` (recomputed from the log: tool calls with no matching toolResult),
bridges them in the browser, and posts the results back into `resume()`.

**LLM boundary (`llm/`).** The only place allowed to import `@earendil-works/pi-ai` (ESLint-enforced
repo-wide; the pinned patch that adds web search + url image sources lives in `frontend/patches/`).
Domain types (`Message`, `AssistantMessage`, `ToolCall`, `Context`, `Tool`, `AssistantMessageEvent`, …)
are **defined here as ours** and merely mirror pi's shapes so the wrappers can cast across the seam —
`tsc` over consumers is the only guard that they stay sufficient. `Api`/`Model` are opaque handles nothing
outside this directory inspects; runtime (`getModel`, `buildRegistryModel`, `buildCustomModel`,
`streamSimple`, `EventStream`) is wrapped, not re-exported. Providers are called directly — there is no
request-path proxy. `setLlmCallRecorder` is an optional app hook keyed on the `X-MX-Request-Call-ID`
header that `streamSimple` stamps: it persists each call's pi-format request, and a failed call's error
(the engine discards the failed message, so the boundary is the only place it exists). Usage is a separate
out-of-band path in the app. `llm/testing.ts` re-exports the faux provider plus the content-keyed
switchboard matcher (`llm/faux-matcher.ts`) tests script responses with.

**Prompts (`prompts/`).** `prompts/prompts.yaml` is the human-edited source of truth;
`prompts/prompt-loader.ts` is a pure render engine over an in-memory `PromptTree` (nested `{a.b}` template
refs, then Python-`str.format` substitution); `prompts/index.ts` binds it to the bundled YAML. Skills are
`skill_*` template keys; `HIDDEN_SKILLS` (the nav skills) never reach the catalog, but the exclusion is
opt-in — every production caller of `listSkills` passes `skipHidden: true`.

## Gotchas

- **Single-use is enforced.** `run()`/`resume()` set `used`; a second call throws. Always construct a new
  `Orchestrator` with the saved log.
- **`projectRootThreadHistory(excludeRootId)`.** On resume the current turn's root invocation is already
  in the log AND its entries come back via `toolThread`, so projecting it as history too duplicates the
  entire turn in every post-resume LLM call (a 712 KB request for a one-turn conversation). Prior turns
  are history; the current turn is the live thread. Pinned by
  `__tests__/resume-context-duplication.test.ts`.
- **`currentTime` is frozen once**, at `run()`, *before* the root invocation is pushed, at hour
  granularity. Re-stamping it during projection invalidates the prompt cache on every turn — that is the
  bug this avoids.
- **`AgentContext` is empty by design, but the engine is not fully blind to it.** It reads/writes exactly
  three well-known structural fields off the stored invocation context, via inline casts: `currentTime`
  (written in `run()`), and `appState` / `attachments` (read in `projectRootThreadHistory`). Everything
  else is opaque pass-through to tools and agents.
- **Dispatch error taxonomy.** Unknown tool, invalid params, and a server tool that *throws* all become
  recoverable `isError: true` toolResults so the agent can retry. The server-throw case is load-bearing:
  without it the unmatched tool call leaves `getPendingToolCalls()` returning a server tool and the browser
  tries to bridge it ("Unknown client-side tool: …"). `UserInputException` is the ONLY exception that
  pauses; any other rejection re-throws and kills the turn.
- **Mixed completion**: completions are appended to the log *before* the aggregate UIE is thrown — breaking
  out early loses completed work. `resume()` chains *upward* (`resumeChain` → `findCallingAgent`), so a
  completed sub-agent re-runs its caller.
- **`appendInterruptResultsForDanglers()` runs on `run()` and `previewRootContext()` but NOT `resume()`** —
  deliberate: resume is the path that supplies the missing results.
- **Retry is per-call, never per-turn** (`llm/retry.ts`). Only `reason === 'error'`, only when nothing has
  streamed yet (`!emitted` — there is no mid-turn delta reset, so re-issuing after content garbles the
  message), only against a *positive* allowlist of transient transport errors, bounded at 2 retries /
  3 attempts (250 ms → 500 ms). The terminal error event is **held** rather than pushed, so a re-issue can
  supersede it instead of the turn runner latching its first `runError`.
- **`stopReason: 'length'` fails the run** in `MXAgent.llm()` — a truncated response re-called with the
  same context fails identically at full input cost (a real conversation once burned $20 looping on
  16-token stubs). Guarded at the one choke point every loop calls, so custom loops inherit it. Output at
  or below 64 tokens ⇒ "context window is full"; larger ⇒ "hit the output cap".
- **`maxSteps`** is a hard cap on `toolThread.length` plus a *soft* cap at `maxSteps − 5`, where tools are
  withheld so the model must answer. Default `Infinity`.
- **`coerceParameters` only rescues stringified args** — a *string* whose schema wants
  array/object/number/integer/boolean is JSON-parsed and `Convert`ed. Genuine wrong-type args are NOT
  silently fixed; they surface as recoverable validation errors. Keep it that narrow.
- **The faux matcher is fail-loud** — duplicate `(userMessage, after)` keys rejected at registration,
  >1 match throws `AmbiguousFauxLLMError`, no match throws `UnexpectedFauxLLMError`. It never silently
  picks one. `setFauxMatches` enqueues the same pure factory `maxCalls` times (default 64) because the
  faux provider consumes one queue entry per LLM call; surplus copies are never consumed.
- **Spawned classes must be in `registrables`.** `lookupCallable` resolves by `schema.name`; a sub-agent or
  tool-spawned tool missing from the registry breaks reconstruction on resume, not just first dispatch.
- **`getSkill` from `prompts/` does not substitute `{schema_*}` placeholders.** Live Atlas schemas live in
  `@/lib/validation`, which this module may not import — `frontend/agents/skill-content.ts` (`loadSkill`)
  augments the tree with them. Never call the raw `getSkill` from agent code.
  (`prompts/__tests__/live-schema-injection.test.ts` pins this.)
- **`pyFormat` is Python `str.format` semantics**: `{{`/`}}` escape to literal braces, a missing variable
  throws, an unbalanced single brace throws. Any literal JSON in `prompts/prompts.yaml` must double its braces.
  Note the two-stage failure mode: an unknown *simple* `{x}` ref passes silently through
  `resolveTemplates` and only fails later in `pyFormat` as "Missing variable 'x'".
- **YAML is parsed at BUILD time and inlined** (yaml-loader for Turbopack/webpack via
  `frontend/next.config.ts`; `@rollup/plugin-yaml` for Vitest) — no runtime fs read, so it survives the
  standalone Docker image. Types come from the `*-yaml.d.ts` shims, not inference.
- **`prompts/story-guidance.yaml` lives here but is consumed by the app**
  (`frontend/lib/data/story/story-templates.ts`) — surprising residency; keep the two in sync.
- **No `@/lib/config`**, so the two optional env overrides (`MAX_LLM_CONCURRENCY`,
  `DEFAULT_CACHE_RETENTION`) are read via `process.env` with inline `no-restricted-syntax` suppressions.
  "Fixing" that by importing config trips the app-agnostic rule.
- **The LLM semaphore is module-level**, shared by every Orchestrator in the process and read once at load;
  `limit <= 0` is a true no-op. In `release()` a freed slot is handed straight to a waiter *without*
  decrementing the counter — do not "simplify" that.
- **`typebox` is version-pinned exactly** (`1.1.37`, no caret) to contain the dual-package hazard: two
  installed copies mean two incompatible `TSchema` brands. Import `Type`/`TSchema`/`Static` from `typebox`
  directly, never through the LLM boundary.

## Code pointers

| Task | File |
|---|---|
| Engine loop, dispatch, pause/resume, log projection | `frontend/orchestrator/orchestrator.ts` |
| `MXTool`/`MXAgent` base classes, `UserInputException`, log + stream types | `frontend/orchestrator/types.ts` |
| Arg coercion/validation, user-turn content builder, error message synth | `frontend/orchestrator/utils.ts` |
| Process-wide semaphore + env limit parsing | `frontend/orchestrator/concurrency.ts` |
| LLM types + wrapped runtime (the pi-ai boundary); retry policy | `frontend/orchestrator/llm/index.ts`, `frontend/orchestrator/llm/retry.ts` |
| Faux provider + `setFauxMatches` for tests | `frontend/orchestrator/llm/testing.ts`, `frontend/orchestrator/llm/faux-matcher.ts` |
| Prompt/skill rendering; prompt + skill content | `frontend/orchestrator/prompts/index.ts`, `frontend/orchestrator/prompts/prompt-loader.ts`, `frontend/orchestrator/prompts/prompts.yaml` |
| **Primary engine contract suite** + its fixture agent (outside this module) | `frontend/agents/test-agent/__tests__/orchestrator-behaviors.test.ts`, `frontend/agents/test-agent/test-agent.ts` |
| How the app wires the engine (registrables, hooks, resume) | `frontend/lib/chat/orchestration-core.server.ts` |
| Turn lifecycle around a run (leases, pending calls, usage) | `frontend/lib/chat/conversation-turn.server.ts` |
| Installed hooks: model plans / credit gate / skill schemas | `frontend/lib/llm/llm-plan.server.ts`, `frontend/lib/analytics/credit-usage.server.ts`, `frontend/agents/skill-content.ts` |
| App-side projection of `_appState` / `_currentTime` into prompt blocks | `frontend/lib/projection/messages.ts` |
| Declarative agent spec runner (assertions over a finished log) | `frontend/orchestrator/__tests__/support/test-spec-runner.ts` |
| App-agnostic + pi-ai import bans | `frontend/eslint.config.mjs` |
