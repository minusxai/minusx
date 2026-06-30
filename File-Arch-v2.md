# File Architecture v2 — `jsx` as source of truth

**Status:** proposal · **Author:** discussion w/ Sreejith · **Date:** 2026-06-23

---

## ⭐ CONVERGED MODEL (implemented 2026-06-24) — markup as the agent's I/O surface

After the M0/M1 stepping stones, the design converged (discussion w/ Sreejith) to a
**content-canonical** model, which is simpler and lower-risk than storing jsx as the source
of truth:

- **`content` (the typed jsonb) stays canonical.** Renders, GUI saves, the server query
  path, and validators are all UNCHANGED. No storage migration.
- **The agent never sees escaped JSON.** It reads + creates + edits every file as **ONE JSX
  document** — a projection of `content`. There is **one uniform converter** (`lib/data/content-jsx.ts`)
  for every file type; no per-type dialect and no "XML" (it was always JSX). The content
  object's fields are the top-level elements:
  - object → nested `<field>…</field>`; array → `<field>` with repeated `<item>` children
  - scalar → `<field>value</field>`; a string containing `<`/`>`/`{` rides in a raw
    template-literal child `{`…`}` (so SQL with `x < 5` stays raw, unescaped)
  - a field tagged **`format:'jsx'`** (e.g. `StoryContent.story`) is emitted **inline** as real
    elements with `<Question id={N}/>` embeds, and parsed back to the stored HTML
  - **schemaless** config types (`connection`/`config`/`context`/…) annotate non-string &
    ambiguous scalars with `type="…"` so they round-trip losslessly (`<port type="number">5432</port>`)
- **The file type's JSON Schema (TypeBox `*Content`) does double duty** — validates *and* drives
  the conversion (nesting, arrays, scalar coercion, which field is a jsx body). Config types with
  no schema fall back to the schemaless `type="…"` form.

### What's implemented (all green: node 2261, orchestrator 493)
- **Engine** (`lib/data/keyvalue-xml.ts`, `lib/jsx/serialize.ts`, `lib/data/dashboard-jsx.ts`,
  `lib/data/file-markup.ts`): schema-driven `propsToXml`/`xmlToProps`, `serializeJsx`
  (AST→jsx), the dashboard body adapter, and `fileToMarkup`/`markupToContent` (the combiner).
  Story reuses `parse/buildStoryJsx`. 15 round-trip tests.
- **Wiring**: `buildCurrentFileStr`→markup, `editFileStr`→`markupToContent`,
  `compressFileState` gains a `markup` field (the agent's edit surface). `content` stays for
  internal consumers. The JSON edit tests were migrated to markup; `key-order`'s old
  JSON-key-order failure mode is DISSOLVED by markup (now a determinism test).
- **Tools**: `ReadFiles`/`EditFile` operate on markup (descriptions rewritten); `CreateFile`
  gains a `markup` arg. **`SetJsx`/`EditJsx` deleted** — a document's jsx body is edited
  through `EditFile` (the markup's `<jsx>` block) like any other file.

### Also done
- **Retired the `questionv2`/`storyv2`/`presentation` file types** (commit "retire …") — the
  base types are markup-edited, so they were redundant/unused. The `question-v2.ts`/`story-v2.ts`
  *adapters* stay (reused by the markup layer). The `jsx` DB column + `setFileJsx` +
  `/api/files/[id]/jsx` are now vestigial (left in place; not removed, harmless).
- **Tutorial seed** — NO change needed: `content` is canonical, so the agent already sees the
  seed as markup. (The earlier "convert the seed to jsx" goal is moot under content-canonical.)

- **`connection` secrets via `@SECRETS/…`** (commit "connection secrets …") — **done**. Raw DB
  credentials never enter the connection document/markup/client: a dedicated **`secrets` table**
  (not a `files` row → structurally unreachable from the agent surface) holds them, keyed by an
  `@SECRETS/connections/<name>/<field>` ref stored in the config. `extractConnectionSecrets` runs
  on save (create + update, with `mergeExistingSecretRefs` so a stripped/unchanged credential
  isn't wiped); `resolveConnectionSecrets` runs server-side at every credential-use point
  (run-query, connection-loader schema introspection, fuzzy-match) right before the connector.
  Backward compatible (legacy raw values pass through + get extracted on next save). `lib/secrets/`.

### Status: all phases implemented and green (node / orchestrator / ui suites all pass).

---

> **M0 + M1 are implemented** on branch `feature/improved-edits-v1` (PR #489). See
> **[M0 + M1 — implementation status & how to test](#m0--m1--implementation-status--how-to-test)**
> at the bottom. Fully additive / backward-compatible; full suite green (node 2234 /
> orchestrator 493 / ui 231).

## Summary

Replace the JSON `content` field with a single **`jsx`** text field: a **static JSX** document that is the file's source of truth.

- Structured config rides as **JSON-valued attributes** (`viz={{…}}`, `connection="github"`) — real literals via JSX `{}` syntax, **not** escaped strings.
- Freeform content (SQL, prose, markup) is **element children** — raw, unescaped.
- **lowercase** tags (`div`, `h1`) → HTML; **Capitalized** tags (`<Question/>`, `<Chart/>`) → our component registry.

It is **data, not code** — parsed and rendered via our component map, **never executed**. `content` is deprecated and removed once all types migrate.

> **Field name** is `jsx` (not `body`) to be explicit about the format. It is a **static subset** — no functions/expressions/handlers (see *Static rules*). The name signals the syntax, not "we run React."

## Motivation

The Jun-21 EditFile debug found a ~42% tool-call failure rate, rooted in **one thing**: the agent hand-authoring exact-match edits over **escaped, minified JSON-inside-JSON**. Three modes, same cause — `changes` sent as a stringified array (A), `oldMatch` not found in the minified-JSON target (B), edit yields invalid JSON (C). Worst case, a story stored as HTML escaped into a JSON string (`<` for `<`, `\n` for newlines): HTML → JSON-string-escaped → JSON-arg-escaped, **three layers**.

Static JSX collapses this: the agent edits **raw text**, and structured config is a **JSON literal in `{}`** — no escaping, because JSX props aren't strings. It's also the format agents author most fluently.

## The format: static JSX as data

**Question:**
```jsx
<Question connection="github" viz={{"type":"bar","xCols":["actor_login"],"yCols":["count"]}}>
SELECT actor_login, count(*) AS count
FROM github_events
WHERE event_type = 'PushEvent'
GROUP BY 1 ORDER BY 2 DESC
</Question>
```

**Story:**
```jsx
<div class="soh">
  <h1>Strait of Hormuz: The Day the Oil Lanes Went Dark</h1>
  <p>…prose…</p>
  <Question id={1090} viz={{"type":"line"}} />
</div>
```

### Compile / render model
- Parse `jsx` with a JSX parser (`@babel/parser` / `acorn-jsx`) → AST.
- **lowercase tags** → HTML elements (sanitized to an allowlist).
- **Capitalized tags** → component registry → rendered **live** (runs queries). Same mechanism as today's `AgentHtml` → `SmartEmbeddedQuestionContainer`.
- **`{…}` attributes** → JSON literals (object/array/string/number/bool). `attr="x"` → plain string.
- **children** → raw text (SQL, prose) or nested components.

> "Compile to HTML" is exact for lowercase tags. Capitalized tags **render** to live components (a chart that runs a query), not static HTML.

### Static rules — what makes it inert data
A JSX parser will happily parse `onClick={fn()}` too, so "static" is a **validation pass you enforce**, not a parser mode:
- Every attribute `{…}` must contain **valid JSON** (a literal). Reject identifiers, calls, member access, arithmetic, ternaries, spreads, and event handlers.
- Tags must be in an **allowlist** (safe HTML tags + registered components).
- **No `eval`, ever** — render only by mapping tag-name → component.

Pass these and the file is **data**: parseable, validatable, deterministically rendered, safe to public-share. (Your rule "attributes accept valid JSON" is the clean invariant — you can `JSON.parse` the text inside the braces directly.)

## Rendering pipeline (isomorphic)

One package — **parser → static validator → AST renderer** — shared by server (validate-on-save, OG / public-share render) and client (GUI). Defining "what `jsx` means" once is what keeps save-validation, public render, and the editor from drifting.

- **Parse** — `acorn` + `acorn-jsx` (lean, fast, ESTree, runs in Node *and* browser). Full grammar, so the validator can give precise errors (*"attribute `viz` uses a call expression — not allowed"*) instead of a parse failure. (`@babel/parser` with the `jsx` plugin is an equivalent choice.)
- **Validate** — an AST walk enforcing the static subset: every attribute `{…}` must be a **JSON literal**; tags ∈ allowlist; no `on*` / event handlers; no expressions / spreads / imports / identifiers. This is the "static" guarantee — the parser does **not** give it for free.
- **Render** — a small recursive AST→element function: `node → createElement(registry[name] ?? sanitizedTag(name), props, children)`. Capitalized → component registry (just `Question` today, extensible `name → component` map); lowercase → **sanitized** HTML.

**Do not** write or fork a JSX parser (more work + maintenance than a post-parse validator, and worse errors). **Do not** use MDX — it *compiles JSX to an executable JS module*, reintroducing the "it's code, not data" problem; we **interpret a static AST** instead.

## Edit primitives (agent tools)

- **`SetJsx(fileId, jsx)`** — replace the whole `jsx`. Default for small files (a question); no matching needed.
- **`EditJsx(fileId, changes: [{oldMatch, newMatch, replaceAll?}])`** — string-replace on `jsx`. For large files (stories). Today's `EditFile`, but over **clean raw text** — including JSON attributes, which are now raw/readable (`viz={{"type":"bar"}}`), not escaped-inside-JSON.
- **`EditProps(fileId, { name?, path? })`** — file-level metadata that lives outside the `jsx`.

**One edit surface for all content** — SQL, viz, layout — is the `jsx` text. No hand-authored escaped JSON anywhere.

### Why this kills A/B/C
- **A** — no JSON args to stringify; `viz` is a JSON literal sitting in raw text.
- **B** — matching against clean, readable `jsx` with real newlines, not minified JSON.
- **C** — becomes "parse `jsx` + validate"; a broken edit is still caught, but the agent edits readable text (far less likely to break), and `SetJsx` avoids matching entirely for small files.

## Fields

- **`jsx`** (text) — source of truth.
- **`meta`** (jsonb) — **minimal**: system/derived fields only (not authored). Structured *config* lives in `jsx` attributes, not here.
- **`references`** (existing column) — **derived** from `<Question/>`/embeds in the `jsx` on save; never hand-authored (avoids drift).
- `name`, `path`, `type` — file props as today.

## Per-type mapping

| Type | `jsx` |
|---|---|
| **question** | `<Question connection=… viz={{…}}>SELECT …</Question>` (SQL = children) |
| **story** | HTML-ish JSX: prose + lowercase tags + `<Question id={…}/>` embeds |
| **dashboard** | composition of `<Question/>` in a layout (lowercase grid / `<Grid>`) → folds toward story |
| **notebook** | a sequence of `<Cell>`/`<Question>` components, each with raw SQL children |

**JSX dissolves the 1-vs-N freeform problem** from the earlier body+meta sketch: each component carries its own raw-text children, so multi-region files (notebooks) compose naturally — no markup-container decision needed.

## Cross-cutting concerns (design before committing)

1. **Validation.** Replace the `atlasSchema` whole-content check (`lib/validation/atlas-schemas.ts`) with: parse `jsx` → enforce static rules → validate each component's props against TypeBox (viz, params) → for questions, validate SQL/connection presence.
2. **Security / XSS.** Public shares (`/l/<id>`) render `jsx`, so this is load-bearing. The static rules stop JS *expressions* but **not HTML-level XSS** — `<script>`, `on*` string handlers, and `javascript:` URLs all pass "static JSX". So allow **broad** HTML (stories need rich styling) but render it **through a sanitizer** (DOMPurify-style allowlist) that keeps styling/layout and strips `<script>`, `on*` handlers, `javascript:` / risky `data:` URLs, and dangerous tags. Components: **`Question` only** for now, via an extensible `name → component` registry. (Decide the `<style>` policy — `@import`, scoping — as part of the allowlist.)
3. **Query hot path.** Running a question needs `query` + `connection` (`lib/connections/run-query.ts`) — now inside `jsx`, so extraction means a parse. **Decision: always parse** (single source of truth, no denormalization drift); **cache the parsed AST keyed by file version** so ExecuteQuery doesn't re-parse on every run.
4. **GUI — two-mode components.** Each component owns both renders: **view** (`<Question/>` → live chart, read-only) and **edit** (`<Question/>` → inline Monaco + viz picker, mutating *that node's* props/children). On edit, **re-serialize surgically** — replace only the edited node's source span in the `jsx` string, leaving the rest byte-for-byte (codemod-style) — so attribute order and untouched SQL whitespace survive. Components are the easy part; **freeform story HTML is the hard part** (a true WYSIWYG over arbitrary HTML is a contenteditable swamp). **v1:** live preview + click a `<Question/>` to edit inline + edit surrounding HTML as `jsx` in a code panel. Standalone questions are trivial — today's editor over the single `<Question>` node.
5. **References.** Derive from `jsx` on save; keep the column.
6. **Migration.** `content` → `jsx` per type (write a `content`→`jsx` serializer each); dual-read window across migrations (`lib/database/migrations.ts`), `compressFileState` (`lib/api/compress-augmented.ts`), and EditFile; remove `content` last.

## Scope boundary

**Static JSX-as-data, not executable React.** The agent authors and edits raw `jsx` text; structured props are JSON literals validated against schemas; nothing is executed — tag-name → component, rendered deterministically. No functions, expressions, handlers, or imports in the file.

## Milestones

Parallel-run / strangler migration: build V2 alongside V1, prove it on stories first (lowest risk, highest value), migrate, then converge. Each milestone is independently testable and backward-compatible — existing `question`/`dashboard`/`story` code stays untouched until M4.

### M0 — `jsx` engine (foundation; decision-independent — start here)
- Add the `jsx` text column (+ reserved unused `meta` jsonb) to the files schema.
- The isomorphic **parse → static-validate → AST→render** package (`acorn` + `acorn-jsx` → validator → renderer), the **sanitizer**, and the `name → component` registry seeded with `Question`.
- **Tests:** parser/validator units, security (XSS strip: `<script>`/`on*`/`javascript:`), render fidelity. *No product surface changes yet.*

### M1 — `QuestionV2` file type, embedded in stories
- New `QuestionV2` type whose `jsx` is `<Question connection=… viz={…}>SELECT …</Question>`. **Existing `question` code untouched** (isolation + backward compat).
- Existing stories can embed a referenced `QuestionV2` file (alongside old questions) — wired into the current story render path.
- Agent tools **`SetJsx` / `EditJsx` / `EditProps`** over the `jsx` field.
- **Success gate (the whole point):** replay the failing EditFile convs (2027 / 2016 / 2041, Strait-of-Hormuz) against QuestionV2 and show A/B/C gone; QA/e2e — agent creates a story with a QuestionV2, edits its SQL, renders live, saves.

### M2 — `DashboardV2`
- A jsx file composing `QuestionV2` embeds in a layout. **Reuses the M0 engine + M1 file type** — new work = layout primitives + grid GUI, not a new engine.

### M3 — migrate V1 → V2
- Backfill `jsx` for existing questions/dashboards, **including the tutorial seed** (`workspace-template.json`) and the QA flows that assert their behavior. `content`→`jsx` serializers per type.

### M4 — converge
- Point canonical Question/Dashboard at the `jsx` path; retire the separate `V2` types. A literal rename is optional churn — gate on **zero V1 files remaining**. (Fold `jsx` into the existing type vs. keep a renamed type: decide here, once M1–M2 prove the model.)

### M5 — remove V1
- Drop the `content` column, the JSON-content EditFile path, old containers, and the dual-read shims.

*Follow-on:* **notebooks** = multi-component `jsx` (after dashboards).

## Resolved decisions

- **Allowlist** — broad HTML **through a sanitizer** (strip `<script>` / `on*` / `javascript:` etc.), plus an extensible `name → component` registry seeded with **just `Question`**.
- **Hot path** — **always parse** `jsx` to extract `query`/`connection`; **cache the AST per file version**. No denormalized columns.
- **GUI** — **two-mode components** (view vs inline editor) with **surgical AST re-serialize**; freeform HTML edited as `jsx` + live preview in v1.
- **`meta`** — config folds into `jsx`; `references`/`name`/`path` stay columns. Keep the `meta` jsonb in the schema as **reserved/unused** (cheap future-proofing; documented as not-yet-used).
- **Parser/runtime** — `acorn` + `acorn-jsx` (or `@babel/parser`) + own static validator + own AST→render function, as **one isomorphic package** shared by server and client. **No fork, no MDX.**

## Still open

- Exact sanitizer allowlist (which tags/attrs; `<style>` policy — `@import`, scoping).
- Surgical re-serialize implementation (source-span replacement fidelity).
- Per-type migration ordering + the `content`→`jsx` serializers.

---

# M0 + M1 — implementation status & how to test

Implemented on `feature/improved-edits-v1` (PR #489), TDD, additive & backward-compatible.

## What shipped

**M0 — jsx engine + schema**
- `frontend/lib/jsx/` — isomorphic `parseJsx` (acorn+acorn-jsx → normalized AST),
  `validateJsx` (static subset + security: JSON-literal attrs only, registered
  components, no `<script>`/`on*`/`javascript:`), `renderJsx` (AST→React via registry,
  never `eval`/`dangerouslySetInnerHTML`). `compileJsx` (client) + `validateJsxSource`
  (server). `lib/jsx/components.ts` = the `Question` allowlist (single source).
- `lib/data/question-v2.ts` — QuestionV2 ⇄ jsx adapter. SQL lives in a **template-literal
  child** `{` … `}` so `<`, `>`, `{` stay raw (only backtick/`${` escaped).
- `files.jsx` TEXT column (idempotent `ADD COLUMN` guard, like `meta`); threaded through
  `DbRow`/`DbFile`/`FileState`/`compressFileState` (the agent's view). Written by
  `DocumentDB.create(jsx?)` + `DocumentDB.updateJsx`; the content publish path never
  touches `jsx` (independent → zero risk to existing files).

**M1 — QuestionV2**
- `questionv2` file type registered end-to-end (FileType, atlas schemas, validators,
  rules.json, template, DbRow, getTemplate). Content is vestigial — the query/connection/viz
  live in the `jsx` body.
- Renders via `SmartEmbeddedQuestionContainer`: a questionv2's `jsx` is parsed into the
  effective `{query, connection_name, vizSettings}` and fed to the existing
  EmbeddedQuestionContainer → query → chart path. **Stories embed a QuestionV2 with the
  same `data-question-id` mechanism — no story change needed.** Plain questions unchanged.
  Standalone `/f/<id>` renders via `QuestionV2ContainerV2` (view-first).
- Agent tools: **`SetJsx`** (replace jsx body — preferred for small bodies), **`EditJsx`**
  (oldMatch/newMatch over the RAW jsx text), **`CreateFile`** gains a `jsx` arg (create a
  questionv2 with its body). Registered in `V2_REGISTRABLES` + `WebAnalystAgent.tools`.
  Persist immediately via `POST /api/files/[id]/jsx` (access-checked + jsx-validated).

## Deferred (not blocking the M1 test)
- **EditProps** (name/path/meta) — the create + edit-SQL path doesn't need it.
- **Rich GUI editor** (two-mode components, surgical re-serialize) — M1 is view-first.
- **Seed sample + prompt steering** — the agent won't *prefer* questionv2 yet, so in testing
  ask for it explicitly (below). Story-as-jsx + content removal are M3–M5.

## How to test (new company)
A new company auto-runs the schema (so the `jsx` column exists). Then:

1. **Create a story** (or open one) and open its side chat.
2. **Ask the agent explicitly**, e.g. *"Create a **QuestionV2** (use the jsx body) that shows
   <metric> from <table>, then embed it in this story."* The agent should call
   `CreateFile(file_type:"questionv2", jsx:"<Question connection=… viz={{…}}>{\`SELECT …\`}</Question>")`
   and add a `data-question-id` embed to the story.
3. **Verify** the chart renders live inside the story (query runs, viz shows).
4. **Edit the SQL** — *"change the question to filter to last 30 days"* — the agent uses
   `SetJsx`/`EditJsx` on the raw jsx; the chart re-renders. (This is the reliability win:
   the agent edits raw SQL, not escaped JSON.)
5. **Publish All**; reload — the QuestionV2 + embed persist.
6. Optional: open the QuestionV2 directly at `/f/<id>` — it renders standalone.

**Backward-compat check:** existing questions, dashboards, stories, and notebooks behave
exactly as before (everything above is additive — new column, new type, new tools).

## Verification done
- jsx engine: parse/validate(security)/render + adapter — 43 unit tests.
- questionv2 registration — validates end-to-end.
- **Server round-trip** (`store/__tests__/questionv2-server.test.ts`): create-with-jsx →
  persists → parses back (raw `<` survives) → `SetJsx` updates → invalid jsx rejected on
  create + set.
- Full suite green: node 2234, orchestrator 493, ui 231.

---

## Story params — `<Param>` components (plan)

**Goal.** A story can declare `<Param>` components in its jsx that form a **shared param context**
for the whole document; every embedded `<Question/>` binds to it by name; a **non-blocking lint
pass** warns when an embedded question needs a param that isn't declared; a param can be **imported
from a question** by id. Reuses the existing param system (`ParameterType` text|number|date,
`ParameterSource`, `syncParametersWithSQL`, `ParameterInput`).

**Shape (agent-authored, in the story jsx):**
`<Param name="city" type="text" nullable={false} id={5} column="city" />`
- `name` (req) · `type` text|number|date (`"string"`→`text`) · `nullable` · `id` = import/autocomplete
  source question · `column` = autocomplete column (default = name). (Inline SQL-source autocomplete
  is a documented follow-up; question-column source covers the common case.)

**Storage.** Param declarations are **derived from the jsx** (like `assets`) — `<Param/>` ⇄
`<div data-param-* />` placeholder inside `content.story`. Submitted/default **values** live in the
new `StoryContent.parameterValues`. No separate stored declarations field.

**Milestones (Types → Tests → Code, each green + committed):** — SP1-SP4 DONE; SP5 follow-up.
- **SP1** — `StoryParam` type; `StoryContent.parameterValues`; `Param` in `JSX_COMPONENT_NAMES`;
  `story-v2` round-trips `<Param/>` ⇄ placeholder; `lib/data/story-params.ts:extractStoryParams(html)`.
- **SP2** — `lintStoryParams(declared, embeddedQuestions)` → warnings (via `syncParametersWithSQL`);
  `resolveImportedParam(param, qContent)` for `<Param id={N}>`.
- **SP3** — wire the lint into `CreateFile`/`EditFile` results as non-blocking `warnings`.
- **SP4** — `AgentHtml` renders a `ParameterInput` at each `data-param` placeholder, holds the shared
  `parameterValues`, and passes them to every `<Question/>` embed (`externalParamValues`).
- **SP5 (follow-up)** — dashboards: keep auto-derive, add the same lint; inline SQL autocomplete source.
