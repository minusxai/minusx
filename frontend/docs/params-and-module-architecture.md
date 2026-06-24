# Parameters & Module Architecture (File-Arch-v2)

How SQL parameters are modeled, how a story's `<Param>` value reaches an embedded
question at runtime, whether the agent can author params (and the validation it gets),
and the module DAG behind it — read through the *A Philosophy of Software Design* lens
(deep modules, one-directional deps, narrow interfaces over wide implementations).

---

## 1. The parameter data model — where values live

A parameter has two halves, stored separately:

| | **Declaration** (name + type + label + source) | **Value** (current/default) |
|---|---|---|
| **Question** | `QuestionContent.parameters: QuestionParameter[]` | `QuestionContent.parameterValues: Record<name, value>` |
| **Story** | *derived* from `<Param>` placeholders in `StoryContent.story` (HTML) | `StoryContent.parameterValues` |
| **Dashboard** | *auto-derived* by merging its questions' params (by name+type) | `DashboardContent.parameterValues` |

`QuestionParameter = { name, type: 'text'|'number'|'date', label, source }`.
`source` (optional) = `{ type:'question', id, column }` — drives autocomplete + type import.

Key idea: **declarations and values are decoupled.** A story doesn't store a `params: []`
field — its params are *derived* from `<div data-param-name=…>` placeholders in the HTML,
so the param lives exactly where the author placed it. Values are a separate dict keyed by
name, so the same control can be re-themed/moved without touching values.

The value states (one rule, enforced at the query chokepoint):

```
"foo" / 100   → a real value, substituted for :param
""  (text)    → a real value (empty string), forwarded as-is
""  (number)  → None: engines can't cast '' to a number → coerced to null  (FIX-2)
null          → None (explicit "Set to None"): IR strips the filter / :param → NULL
```

---

## 2. Runtime value-flow: story `<Param>` → embedded question

The value is **not** an SQL/DB context. It is a shared React state (`values` in `AgentHtml`)
threaded down to each embedded question as props. One control drives every embed using
that `:param`.

```
 StoryContent.story  (one HTML doc)
 ├─ <div data-param-name="min_mrr" data-param-type="number" …>   ← a Param placeholder
 └─ <div data-question-id="1026" …>                              ← an embed placeholder
        │
        ▼  rendered by
 ┌──────────────────────────── AgentHtml ────────────────────────────┐
 │  scans [data-param-name]  →  paramTargets: {el, param}[]          │
 │       (paramFromPlaceholderEl)                                    │
 │  holds  values: Record<name, value>   ◄──── seeded from           │
 │                                              content.parameterValues│
 │                                                                   │
 │  per param  → portal-mounts  StoryParamControl                    │
 │                 (reader types a value → setParamValue → values++) │
 │                                                                   │
 │  per embed  → mounts SmartEmbeddedQuestionContainer with:         │
 │      externalParameters  = paramTargets.map(storyParamToQuestionParameter)
 │      externalParamValues = values   ───────────────────┐         │
 └────────────────────────────────────────────────────────┼─────────┘
                                                           ▼
                          SmartEmbeddedQuestionContainer  (merges external → its param schema)
                                                           ▼
                          EmbeddedQuestionContainer
                            queryParams = buildQueryParamValues(
                                question.parameters, ownValues, externalParamValues)
                                  • external value wins over the question's own
                                  • empty-number → null  (isEmptyNumeric)
                                                           ▼
                          useQueryResult(query, queryParams, …, { parameterTypes })
                            • noneifyEmptyNumericParams(params, types)  ← single coercion,
                              so the execute-effect AND the result selector share one key
                                                           ▼
                          getQueryResult → POST /api/query → connector → rows → chart
```

When the reader changes the control: `values` updates → `AgentHtml` re-renders →
`externalParamValues` changes → every embed using that name re-executes with the new value.
(Proven live: `min_mrr=1600` filtered the embedded MRR chart to the months ≥ 1600.)

Dashboards use the *same* `externalParameters`/`externalParamValues` mechanism via
`DashboardView`; their controls are auto-derived from the questions instead of `<Param>` tags.

---

## 3. Can the agent author params? Yes — and it gets non-blocking validation

The agent never edits JSON. It reads/writes **one JSX document** (the markup projection of
`content`). To add a story param it writes:

```jsx
<Param name="min_mrr" type="number" nullable={true} />          // a plain reader filter
<Param name="city" type="text" id={1026} column="city" />       // imports type + autocomplete from Q1026
```

On save, `markupToContent` (→ `parseStoryJsx` → `placeholdersToParamJsx`) round-trips each
`<Param>` to a `<div data-param-*>` placeholder inside `content.story`. For questions it writes
the `<parameters><item>…</item></parameters>` subtree directly.

**Validation is permissive: the edit is ALWAYS applied; feedback is returned, never blocked.**
`collectEditValidation` (in `file-state.ts`) runs on every edit and returns `validation: string[]`:

```
edit (any) ─▶ validateFileState   (Ajv schema — structural correctness)
   story  ─▶ lintStoryParams      ":city needed by Q5 but no <Param> declared" / type mismatch / declared-but-unused
          ─▶ lintStoryParamSources "<Param id={1}> imports from question #1, which doesn't exist"   (FIX-1)
   dash   ─▶ lintDashboardParams  ":min_mrr has conflicting types (number vs text) across Q1026, Q1050 — won't share one filter"  (SP5b)
```

These are advisory — the agent gets them as text and can self-correct (it did, live: it added
the missing `<Param name="min_mrr">` and surfaced the unused `region` warning). **Save/Publish**
is the hard gate (schema-valid required); routine edits are never blocked.

---

## 4. Module architecture (the DAG)

Dependencies point **one way, downward** — UI → orchestration → pure transforms → leaf
engines. No cycles. Lower layers never import upward.

```
 ┌─ UI (React; stateful, impure) ──────────────────────────────────────────────┐
 │  AgentHtml ─▶ SmartEmbeddedQuestionContainer ─▶ EmbeddedQuestionContainer    │
 │     │                                                   │                    │
 │     └─▶ StoryParamControl ─▶ ParameterInput             │                    │
 └─────────┬───────────────────────────────────────────────┬───────────────────┘
           │ (story-params: types+conversions)              │ (hooks)
           ▼                                                 ▼
 ┌─ hooks ──────────────────────────────────────────────────────────────────────┐
 │  file-state-hooks  (useQueryResult, useFile, …)                              │
 └─────────┬────────────────────────────────────────────────────────────────────┘
           │
           ▼
 ┌─ orchestration (stateful core; the one wide module) ─────────────────────────┐
 │  file-state.ts   getQueryResult · editFileStr · editFile · collectEditValidation │
 └──┬───────────────┬───────────────────┬───────────────────┬───────────────────┘
    │               │                   │                   │
    ▼               ▼                   ▼                   ▼
 file-markup   content-validators   story-params        sql-params
 (combiner)    (Ajv: validateFile)  (Param ⇄ jsx,       (extract/sync params,
    │               │                lints)              buildQueryParamValues,
    ▼               ▼                   │                 noneifyEmptyNumericParams)
 content-jsx   atlas-json-schemas      │                   │
 (content⇄jsx) │                       ▼                   ▼
    │          ▼                    atlas-schemas (TypeBox — single source of truth)
    ▼     atlas-schemas                  ▲
 story-v2 ─▶ story-params ───────────────┘ (types only)
    │
    ▼
 lib/jsx  (parseJsx · serializeJsx · validateJsxSource — the static-JSX engine; leaf)
```

**Leaf engines (deep, pure, zero project deps):**
- `lib/jsx/` — the static-JSX engine. Exports `parseJsx`, `serializeJsx`, `validateJsx`,
  `validateJsxSource`. Hides acorn + the security rules behind 4 functions.
- `lib/validation/atlas-schemas.ts` — TypeBox schemas (the ONE source); `atlas-json-schemas.ts`
  derives the Ajv-ready JSON Schema at module load.
- `lib/sql/sql-params.ts` — pure param logic. Exports `extractParametersFromSQL`,
  `syncParametersWithSQL`, `paramTypeMap`, `noneifyEmptyNumericParams`, `buildQueryParamValues`,
  `inferParameterType`, label/type-icon helpers.

**Pure transforms (one input → one output, no I/O, no Redux):**
- `lib/data/content-jsx.ts` — **deep**: `contentToJsx(value, schema, ctx)` /
  `jsxToContent(jsx, schema, ctx)`. A ~300-line implementation (schema walk, discriminated-union
  resolution, raw-leaf escape hatch, jsx-field inlining) behind a 2-function interface.
- `lib/data/story-v2.ts` — `parseStoryJsx` / `buildStoryJsx` (the `<Question>`/`<Param>` ⇄
  placeholder bridge inside a story's HTML).
- `lib/data/story-params.ts` — `StoryParam` type + all `<Param>` conversions + the three lints.
- `lib/data/file-markup.ts` — thin combiner: binds a `FileType` to its schema and calls
  content-jsx. Exports `fileToMarkup` / `markupToContent`.
- `lib/validation/content-validators.ts` — `validateFileState` (Ajv).

**Orchestration:** `lib/api/file-state.ts` — the one stateful, wide module. It is the
documented CORE (all file/query ops). Pulls the pure transforms together + Redux + fetch.

### Exact imports (project-internal only) — the edges above

```
sql-params.ts        →  lib/types                          (QuestionParameter — PURE; no React)
param-type-display.ts→  react-icons, atlas-schemas(types)  (UI icon/color helpers, split out of sql-params)
atlas-json-schemas   →  atlas-schemas
story-params.ts      →  atlas-schemas (types), sql-params  (syncParametersWithSQL)
story-v2.ts          →  lib/jsx, lib/types, story-params, utils/immutable-collections
content-jsx.ts       →  lib/jsx, lib/jsx/components         (file-type-AGNOSTIC: jsx-field codec is injected via SchemaCtx)
file-markup.ts       →  content-jsx, story-v2, atlas-json-schemas, lib/types   (binds schema + jsx-field codec)
content-validators   →  ajv, atlas-json-schemas, lib/types, config-validators
file-state.ts        →  file-markup, story-params, sql-params, content-validators, store, …
file-state-hooks.ts  →  file-state, sql-params
AgentHtml.tsx        →  SmartEmbeddedQuestionContainer, StoryParamControl, story-params
EmbeddedQuestionCt   →  file-state-hooks (useQueryResult), sql-params (buildQueryParamValues)
ParameterInput.tsx   →  param-type-display (icons), file-state-hooks, …
```

> Note the flattening from the wart fixes: `content-jsx` no longer imports `story-v2`
> (the `format:'jsx'` codec is injected through `SchemaCtx.jsxField`), so `content-jsx`
> and `story-v2` are now **siblings** both wired by `file-markup` — the generic converter
> knows nothing about stories. And `sql-params` is now pure (React lives in `param-type-display`).

---

## 5. PoSD scorecard — what's deep, and the honest warts

**Deep modules (small interface, large hidden implementation) — the wins:**
- `content-jsx` — 2 functions hide the entire content⇄jsx machinery (schema walk, unions,
  raw leaves, jsx-field inlining). Callers never see a schema node.
- `lib/jsx` — 4 functions hide acorn + the JSX security model.
- `file-markup` adds the only thing content-jsx lacks — *which schema for which file type* — so
  the rest of the app calls `fileToMarkup(type, content)` and knows nothing about schemas.
- The agent's whole surface is **one JSX document**; the canonical typed jsonb is fully hidden
  behind file-markup. Maximal information hiding: change the storage shape, the agent is unaffected.

**One-directional DAG:** the schema (`atlas-schemas`) is the single sink everything points at;
`lib/jsx` is the other leaf. Nothing imports upward; no cycles.

**Single source of truth, twice over:** the TypeBox schema drives *both* conversion (content-jsx)
*and* validation (content-validators) *and* the agent's tool descriptions — edit one file.
The empty-numeric→None rule lives once (`isEmptyNumeric`) behind two entry points
(`buildQueryParamValues` for assembly, `noneifyEmptyNumericParams` for the chokepoint).

**Resolved (this pass):**
1. ✅ **`sql-params` is now pure** — `getTypeIcon`/`getTypeColor` moved to `lib/sql/param-type-display.ts`;
   the dead `getTypeColorHex` deleted. Server/test code imports the param logic without pulling React.
2. ✅ **`content-jsx` is now file-type-agnostic** — the `format:'jsx'` codec is injected via
   `SchemaCtx.jsxField` (`file-markup` wires the story-v2 codec). The generic converter no longer
   imports a specific file type's module. This also flattened the graph (content-jsx ∥ story-v2).
3. ✅ **Vestiges removed/narrowed** — `resolveImportedParam` (unwired: only ever called from a test,
   never the app) deleted; `inferParameterType`/`generateLabel` un-exported (internal to
   `syncParametersWithSQL`). `extractParametersFromSQL`/`normalizeParamType`/`paramToJsx` kept exported
   (genuine, directly-tested codec/utility primitives — not implementation leakage).

**Remaining, intentional:**
- **`file-state.ts` is wide** — a *deliberate* single integration seam (the impure boundary: Redux +
  fetch + the pure transforms). Watch it for creeping responsibilities; new *pure* logic belongs in
  the leaf modules, not here.
- **`file-markup` is thin but not a vestige** — it's the only place that binds *file-type → schema*
  and provides the jsx-field codec (things `content-jsx` deliberately doesn't know). Keep it thin.

> Net: the core (jsx engine, content-jsx, the schema source, sql-params) is deep, pure, and cleanly
> one-directional with no cycles. The two purity warts are fixed; the remaining wide module is the
> intentional impure seam.
