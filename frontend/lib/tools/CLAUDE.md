# Frontend-bridged tools

The browser-side execution of tool calls the server cannot run. When a server tool needs Redux or the
DOM it throws `UserInputException` / `FrontendToolException`, the orchestrator returns the call as
pending, and `executeToolCall` runs it here before resuming the server run.

It does **not** own the LLM-facing arg schemas — those are TypeBox objects colocated with the tool
class in `frontend/agents/web-analyst/web-tools.ts`. It does not own file mutation either: every
handler goes through `frontend/lib/file-state/file-state.ts`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

**Frontend-bridged tool call**

```
LLM → orchestrator (server tools run in-process)
        │  frontend-only tool → UserInputException → pending
        ▼
   chatListener (store/chatListener.ts)
        └─ executeToolCall(toolCall, dispatch, signal, state, userInputs)   lib/tools/tool-handlers.ts
              └─ frontendToolRegistry[name] → handlers/<tool>.ts
                    ├─ file mutation      → lib/file-state/file-state.ts
                    ├─ needs user consent → throw UserInputException (pause again)
                    └─ result {content, details}
        ▼
   completeToolCall → POST turns → orchestrator resumes
```

`executeToolCall` derives `contextPath` by scanning `state.chat.conversations` for the
conversation whose `pending_tool_calls` contains this call id, then reading its
`agent_args.context_path` — that is how `LoadSkillFrontend` finds the active Knowledge Base
context. `content` is what the LLM sees; `details` is UI-only and survives the turn (this is
where `screenshotUrl` rides so a reloaded log still shows the image).

`EditFile` (`lib/tools/handlers/edit-file.ts`) is the deepest handler and is worth reading as
the canonical shape: validate all `changes` in memory against `buildCurrentFileStr` → run
type-specific pre-apply gates (viz envelope via `lib/viz/validate-remote`, semantic-model tiers
1–2 via `lib/semantic/edit-check`) → single atomic `editFileStr` → post-edit bounds check for
contexts → auto-execute the affected queries (question / notebook cells / story embeds) →
re-read → review. `CreateFile` mirrors it minus the diffing.

**Review / rubric** — `handlers/file-review.ts` is shared by `EditFile`, `CreateFile` and
`ReviewFile`:

```
reviewFile(fileId)
  ├─ captureFileScreenshot → lib/screenshot/capture (readinessTimeoutMs: 20000)
  │     ├─ readiness.settled === false → rules-only rubric + screenshot + renderPending note
  │     └─ settled → FilesAPI.getRubric({screenshotUrl, content, measuredEmbeds}) → full rubric
  └─ capture threw (view not mounted) → deterministicAgentRubric(fileId) only
```
