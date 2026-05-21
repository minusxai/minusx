# LLM provider migration

This folder is the LLM **boundary**: the only place in the codebase allowed to
import `@mariozechner/pi-ai`. It exists so the underlying LLM library can be
replaced (pi-ai → Vercel AI SDK) by reimplementing this one surface, without
touching consumers. An ESLint rule (`no-restricted-imports` → `@mariozechner/pi-ai`)
enforces the boundary everywhere except `orchestrator/llm/**`.

## Status

- **Milestone 1 — DONE.** pi-ai is fully isolated to `orchestrator/llm/`.
  Consumers import the owned types + wrapped runtime from `@/orchestrator/llm`,
  faux/test helpers from `@/orchestrator/llm/testing`, and typebox directly from
  `typebox`. `@mariozechner/pi-ai@0.73.0` and `typebox@1.1.37` are version-frozen.
- **Milestone 2 — pending.** Reimplement the export surface below on the Vercel
  AI SDK (`@ai-sdk/*`); the linter + types tell you when the swap is complete.

## Rules for the rest of the codebase

- Import LLM **types and runtime** from `@/orchestrator/llm`.
- Import **faux/test helpers** from `@/orchestrator/llm/testing`.
- Import **typebox** (`Type`, `TSchema`, `Static`) directly from `typebox`.
- Never import `@mariozechner/pi-ai` directly.

## Export surface (the Milestone-2 spec)

### `@/orchestrator/llm`

**Owned domain types** — defined here, not re-exported from pi. They currently
mirror pi's shapes (so the wrappers can cast across the seam) but are ours to
reshape for Vercel; `tsc` over all consumers is the guard that they stay
sufficient: `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall`,
`Usage`, `StopReason`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`,
`Message`, `Tool`, `Context`, `AssistantMessageEvent`, `StreamOptions`.

**Opaque handle types** — aliased to pi; nothing outside this boundary inspects
their fields (verified), so they become the Vercel `LanguageModel` handle with
zero consumer churn: `Api`, `Model`.

**Runtime** — wrapped, not re-exported:
- `getModel(provider, model)` — resolves a model handle; routes through the MX
  proxy when configured, direct otherwise (OSS).
- `streamSimple(model, context, options?)` — one model call → stream of
  `AssistantMessageEvent`.
- `EventStream<T, R>` — generic async-event stream class.

### `@/orchestrator/llm/testing`

- `registerFauxProvider(options)` — register a deterministic faux provider.
  (Also used by production agents for their `fauxRegistration` fallback handle.)
- `fauxAssistantMessage(...)`, `fauxToolCall(...)` — build faux responses.
- `FauxResponseStep` — queued faux response type.

In Milestone 2 these map onto Vercel's `MockLanguageModelV2` — keep that swap
single-homed in `testing.ts`.

## Notes for Milestone 2

- The owned domain types are structurally identical to pi's today (the faux and
  stream seams require it) — e.g. `AssistantMessage.diagnostics` references pi's
  diagnostic type for compatibility. Their shapes diverge when the Vercel model
  lands, which can ripple to consumers; the boundary keeps that ripple contained
  to single-homed adapter functions, it does not eliminate it.
- The faux test helpers are thin re-bindings of pi's, so tests are
  import-isolated but their mock model still needs the `MockLanguageModelV2`
  swap — single-homed in `testing.ts`.
- Versions are frozen because we own a boundary against pi's exact shapes and
  remove pi in Milestone 2 — a floating minor only risks surprise breakage.
  `typebox` is pinned to the single resolved version pi uses, to avoid the
  dual-package hazard (two incompatible `TSchema` brands).
