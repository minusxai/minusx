# Frontend-bridged tools

The browser-side execution of tool calls the server cannot run. When a server tool needs Redux or the
DOM it throws `UserInputException` / `FrontendToolException`, the orchestrator returns the call as
pending, and `executeToolCall` runs it here before resuming the server run.

It does **not** own the LLM-facing arg schemas — those are TypeBox objects colocated with the tool
class in `frontend/agents/web-analyst/web-tools.ts`. It does not own file mutation either: every
handler goes through `frontend/lib/file-state/file-state.ts`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## The bridge

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

`tool-handlers.ts` is registry + entry point only; every handler body lives in its own module under
`lib/tools/handlers/`, and the shared `FrontendToolContext` / `ToolHandlerResult` /
`FrontendToolHandler` types live in `handlers/types.ts` rather than in the barrel, so the dependency
direction stays one-way (barrel → handlers, never back).

`executeToolCall` derives `contextPath` by scanning `state.chat.conversations` for the
conversation whose `pending_tool_calls` contains this call id, then reading its
`agent_args.context_path` — that is how `LoadSkillFrontend` finds the active Knowledge Base
context. `content` is what the LLM sees; `details` is UI-only and survives the turn (this is
where `screenshotUrl` rides so a reloaded log still shows the image).

## EditFile — the canonical handler

`EditFile` (`lib/tools/handlers/edit-file.ts`) is the deepest handler and is worth reading as
the canonical shape: validate all `changes` in memory against `buildCurrentFileStr` → run
type-specific pre-apply gates (viz envelope via `lib/viz/validate-remote`, semantic-model tiers
1–2 via `lib/semantic/edit-check`) → single atomic `editFileStr` → post-edit bounds check for
contexts → auto-execute the affected queries (question / notebook cells / story embeds) →
re-read → review. `CreateFile` mirrors it minus the diffing.

**`replaceAll` defaults to `false`, and a non-unique `oldMatch` is an ERROR, not a silent
multi-replace.** The default lives in `lib/file-state/file-edit.ts` and is mirrored in the
handler's own in-memory dry run, so both halves refuse identically: the change is rejected with
an occurrence count and a two-option fix (extend `oldMatch`, or opt in to `replaceAll`). A
`replaceAll` edit that touched more than one site reports `occurrences` back, so multi-site
rewrites are never invisible.

## Review / rubric

`handlers/file-review.ts` is shared by `EditFile`, `CreateFile` and `ReviewFile`:

```
reviewFile(fileId)
  ├─ captureFileScreenshot → lib/screenshot/capture (readinessTimeoutMs: 20000)
  │     ├─ readiness.settled === false → rules-only rubric + screenshot + renderPending note
  │     └─ settled → FilesAPI.getRubric({screenshotUrl, content, measuredEmbeds})
  │            ├─ report → full rubric              reviewMode: 'full'
  │            └─ threw / no report → rules-only rubric, screenshot KEPT, reviewNote
  └─ capture threw
        ├─ /not found/i (view not mounted — expected) → deterministicAgentRubric(fileId), no note
        └─ anything else (serialize / rasterize / upload) → same, plus a reviewNote
```

`reviewFile` never throws — a review failure must not fail the edit that triggered it. The two
note fields are what keep a *degraded* review from reading like a clean one: `renderPending` says
the blank cards are capture timing (agents previously deleted healthy embeds over them), and
`reviewNote` says the visual judge never answered. `reviewMode` (`'full' | 'deterministic'`) is
the machine-readable version of the same distinction.

What lands permanently in the conversation is not the full rubric: `compactAgentRubric` keeps
`overall`/`grade` and, per finding, `ruleId`/`category`/`severity`/`title`/`detail`/`fix` — with
`title` clipped to 120, `detail` to 140, and `fix` to 200 *except* on an `error`, which keeps its
whole instruction because an error gates the score to 0.

## Interactions with other areas

| Boundary | Contract |
|---|---|
| `store/chatListener.ts` → `lib/tools/tool-handlers.ts` | Calls `executeToolCall`; catches `UserInputException` (`lib/tools/user-input-exception.ts`) to raise a `UserInputComponent` prompt and re-invoke with `userInputs` filled. Handlers must be re-entrant: the second call sees `userInputs[0].result`. |
| `agents/web-analyst/web-tools.ts` ⇄ `lib/tools/handlers/*` | The TypeBox schema and the handler are two halves of one contract, enforced in CI by `lib/tools/__tests__/tool-schema-sync.test.ts`: it parses each handler's *source text* and fails if the handler reads an `args` key the schema doesn't declare, or the schema declares a param the handler never reads. |
| `lib/tools/handlers/*` → `lib/file-state/file-state.ts` | Every read/edit/create/query goes through `readFiles`, `editFileStr`, `editFile`, `createDraftFile`, `getQueryResult`. Nothing here talks to `/api/files` directly. |
| `components/explore/*` → `lib/tools/tool-config.ts` | `getToolConfig(name)` returns `{displayComponent, chipLabel, chipLabelPlural, chipIcon, timelineVerb}`, with a `DefaultToolDisplay` fallback for unknown tools — a new tool renders without touching this file. |

## Gotchas

- **`Screenshot` is a live registration, not dead code.** The class still exists
  (`agents/web-analyst/web-tools.ts`, sharing `ReviewFileParams` with `ReviewFile`), is listed in
  `REGISTRABLES` (`lib/chat/orchestration-core.server.ts`), and `handlers/screenshot.ts` is nothing
  but `export { reviewFileHandler as screenshotHandler }` — so a saved log with a pending
  `Screenshot` call still resolves on both sides and resumes. It is not in any agent's advertised
  toolset.
- **A mid-load screenshot suppresses the visual judge.** When `readiness.settled` is false,
  `reviewFile` returns the deterministic rubric plus a `renderPending` note; grading spinner
  pixels previously drove agents to delete healthy embeds.
- **`CreateFile` never renders a chart image** (a created file is always a background draft) and
  refuses `dashboard`/`story` in the background unless `selectUnrestrictedMode` is on — those must
  go through `Navigate` with `newFileType`.
- **`CreateFile`'s `content` arg accepts a JSON *string* as well as an object**
  (`Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.String()]))`), and
  the handler `JSON.parse`s the string form explicitly. The union is defensive, not a preference:
  spreading a string into content produced `{"0":"{","1":"\n",…}` while still returning
  `success: true`. `markup` is the preferred arg for a new file's body; `content` is the
  structured fallback merged over template defaults.

## Key files

| Task | File |
|---|---|
| Register / route a frontend-bridged tool | `frontend/lib/tools/tool-handlers.ts` |
| Handler signature + `content` vs `details` contract | `frontend/lib/tools/handlers/types.ts` |
| Pause a tool for user input | `frontend/lib/tools/user-input-exception.ts` |
| Edit pipeline, validation gates, auto-execute | `frontend/lib/tools/handlers/edit-file.ts` |
| Screenshot + rubric core | `frontend/lib/tools/handlers/file-review.ts` |
| Chat UI chip/timeline config per tool | `frontend/lib/tools/tool-config.ts` |
| String-replace semantics (`replaceAll`, uniqueness) | `frontend/lib/file-state/file-edit.ts` |

**Why file edits go through markup at all.** A June-2026 investigation measured a ~42% `EditFile` tool-call failure rate, and all three failure modes shared one cause: the model hand-authoring exact-match edits over escaped, minified JSON-inside-JSON — `changes` arriving as a stringified array, an `oldMatch` that does not appear in the minified target, and edits that produce invalid JSON. The worst case, a story stored as HTML, escaped into a JSON string, inside a JSON tool argument, was three layers of escaping. The fix was to hand the agent one JSX-shaped document of raw text in which structured config is a JSON literal inside `{}` — JSX props are not strings, so nothing needs escaping. Do not add a tool that asks the model to edit escaped JSON, whatever the convenience.
