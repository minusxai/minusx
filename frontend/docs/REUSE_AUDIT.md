# Reuse / DRY Audit — story-v2 & adjacent code

> Working tracker for the "don't re-implement, reuse" pass, in the spirit of Ousterhout's
> *A Philosophy of Software Design*: **deep modules with simple interfaces, one source of truth,
> eliminate duplicated logic**. Every entry below is either DONE (extracted + reused) or PENDING
> (a concrete extraction with file:line, a suggested home, and rough risk/effort).
>
> This is the single place to track this work — add findings here rather than scattering TODOs.

## ✅ Done (this pass)

| Concept | Shared home | Was duplicated in |
|---|---|---|
| `storyEmbedRuns(html, params)` — which queries a story body runs + with what params | `lib/data/helpers/param-resolution.ts` | client `augmentWithParams`, server `executeQueriesForFile`, EditFile auto-execute (3×) |
| `setCachedResult()` — cache data/error → augmentation map | `lib/data/helpers/param-resolution.ts` | `augmentWithParams` question/notebook/inline-question/inline-number (4×) |
| `runResolved()` — execute pre-resolved params + push data/error | `lib/api/file-state.server.ts` | split out of `runOne` |
| `bindReferencedParams(query, values)` — bind the `:names` a raw query references | `lib/sql/sql-params.ts` | new; used by InlineNumber renderer + storyEmbedRuns (same hash both sides) |
| `escTemplate`, `styleAttr` | `lib/data/html-attr.ts` | story-number.ts, story-question.ts, story-params.ts (3×) |
| `normalizeInlineQuery` (cook `\n`/`\t`) | `lib/data/story-question.ts` | now reused by `<Number>` (was `<Question>`-only) |
| **SqlEditor reuse** — edit an inline `<Number>`'s query | `components/SqlEditor.tsx` via `NumberQueryEditor` | replaced a hand-rolled `<textarea>` |

## 🔜 Pending — story codecs (`story-question.ts` / `story-number.ts` / `story-params.ts`)

These three codecs are near-mirror images; the shared shape should live in one place (e.g.
`lib/data/helpers/embed-codec.ts`). Risk: low-med (pure functions, well-tested round-trips guard them).

- **`buildJsxAttrs(attrs)` emitter** — "push attrs to an array, join with spaces": `numberToJsx`
  (story-number.ts:~98), `inlineQuestionToJsx` (story-question.ts:~129), `paramToJsx`
  (story-params.ts:~94). Extract a generic attr-list builder.
- **`buildDataAttrs` / placeholder builder** — JSON-escape + `data-*` attr assembly:
  `numberToPlaceholder` (story-number.ts:~51), `inlineQuestionToPlaceholder` (story-question.ts:~54),
  `paramToPlaceholder` (story-params.ts:~76).
- **`parseEmbedJson(raw)`** — `JSON.parse(unescAttr(raw))` + validity null-check repeated as
  `embedFromJson` (story-number.ts:~60), and the equivalents in story-question.ts:~84 / story-params.ts:~113.

## 🔜 Pending — rendering (`InlineNumber.tsx`, embedded question containers, `AgentHtml.tsx`)

- **`extractSingleCellValue(data, col, formatter)`** — `formatCell` + "pick col else first column,
  read `rows[0][col]`": InlineNumber.tsx:~22 and both number variants (~59–78). Likely the same
  pattern in `EmbeddedQuestionContainer` single_value. Home: `lib/chart/chart-utils.ts`. Risk: low.
- **AgentHtml discovery loops** — 4 near-identical `querySelectorAll(...) → parse → (size/clear) →
  push` blocks (AgentHtml.tsx ~200–246) for question/inline-question/number/param. Extract a
  `discoverPlaceholders(root, selector, parse)` helper. Risk: med (DOM + effect ordering).
- **AgentHtml portal blocks** — 4 `createPortal(<EnvironmentProvider>…</EnvironmentProvider>, el, key)`
  blocks (~348–425). Extract a `<PortaledEmbed>` wrapper. Risk: med.

## 🔜 Pending — data flow (`tool-handlers.ts`)

- **Auto-execute** — the clear-cache + `setEphemeral`/`setExecuted` + best-effort `getQueryResult`
  pattern repeats across EditFile-question / EditFile-notebook / EditFile-story / CreateFile-question
  (tool-handlers.ts ~640–734, ~933–965). Extract `autoExecuteQuestion()` / a shared runner. Risk: med
  (best-effort semantics + Redux dispatch ordering must be preserved; guarded by editFile.test.ts).

## Notes / principles applied here

- **One source of truth for a query's identity:** renderer, client augmentation, server execution,
  and EditFile auto-execute must compute the SAME `getQueryHash` from the SAME params. The bug that
  motivated this audit (inline numbers invisible / unbound) was *caused* by three copies drifting —
  consolidating into `storyEmbedRuns` + `bindReferencedParams` made the hashes line up by
  construction. That is the DRY payoff: correctness, not just brevity.
- **Reuse the deep module, don't re-skin it:** the SqlEditor is a deep module (Monaco + autocomplete
  + validation behind a small `value/onChange/schemaData` interface). Re-implementing a textarea was
  shallow duplication; reusing SqlEditor (in a light-DOM modal, since Monaco can't live in the story
  shadow root) is the elegant call.

_A broader codebase-wide sweep is in progress; findings will be appended here._
