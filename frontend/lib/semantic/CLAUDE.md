# Semantic models, contexts, views and Atlas schemas

Authored semantic models, the context tree and its whitelisting, saved views, and the Atlas content
schemas that validate every file type (`lib/semantic`, `lib/context`, `lib/views`, `lib/validation`).

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

Four cooperating modules under `frontend/lib/`: `validation/` (TypeBox schemas — the single source of truth for file content shapes), `context/` (knowledge-base plumbing: whitelists, versions, budgets, the agent's flat view), `views/` (curated SQL exposed as virtual tables), and `semantic/` (business vocabulary compiled to IR). `types/` is a barrel plus domain modules; the semantic and views types are re-exports of TypeBox statics, not hand-written duplicates.

## What each module owns

**`lib/validation/`** owns the shape of Atlas file content. `atlas-schemas.ts` is authored in TypeBox: each `export const X = Type.Object(...)` is simultaneously a runtime JSON Schema and a static type via the colocated `export type X = Static<typeof X>`. `atlas-json-schemas.ts` rebuilds the plain-JSON artifacts at module load (`JSON.parse(JSON.stringify(...))` strips TypeBox's `Symbol(Kind)` metadata so Ajv accepts them) into `atlasSchema` — one discriminated `oneOf` with a `$defs` block — and additionally renders per-file-type schema text for skill prompts (`SCHEMA_TEMPLATE_VARS` → `{schema_question}`, `{schema_context}`, …). `atlasSchema` is the single source for file-type content validation: `content-validators.ts` compiles exactly four Ajv validators against it at module load (`QuestionContent`, `DashboardContent`, `StoryContent`, `NotebookContent`), and `lib/data/story/file-markup.ts` reads `atlasSchema.$defs` as the `$ref` table it hands to `lib/data/story/content-jsx.ts` for content↔markup conversion. `content-validators.server.ts` is the `server-only` extension: `validateFileStateServer` runs the same structural checks plus a live connector test for `connection` files, and it is what `FilesAPI.saveFile` calls. `lib/validation/` does **not** own: viz spec grammars (Vega-Lite/Vega bodies are opaque `Type.Record`s here and validated in `lib/viz/validate.ts`), context content (see gotchas), or form-input validation (`validators.ts` is unrelated workspace-name/email/password helpers).

**`lib/context/`** owns everything about a context *document* except its schema resolution: whitelist merging and legacy-format coercion (`context-utils.ts`), nearest-context lookup, published-version selection, the name whitelist for inherited views/models (`name-whitelist.ts`), the editor's version fold (`version-edit.ts`), the agent's flattened read/write projection (`context-agent-view.ts`), memory bounding of computed schemas (`schema-bounding.ts`), every prompt/UI char budget (`context-budgets.ts`), doc-metadata completeness (`doc-validation.ts`) and the dataset-onboarding status roll-up (`dataset-context-status.ts`).
`skill-utils.ts` and `agent-utils.ts` are the naming pair for user-authored skills and custom agents: a
canonical key (`canonicalizeUserSkillName` / `canonicalizeUserAgentName` — lowercase, non-`[a-z0-9_]`
collapsed to `_`), a collision-free variant (`unique*Name`), and a `get*DisplayName` that humanizes the
key for entries predating `displayName`. The key is what prompts, `LoadSkill` and the `custom_agent`
pointer address; the display name is UI-only, so renaming the label can never break a saved
reference. It does **not** own schema *computation* or inheritance — that is `lib/data/loaders/context-loader.ts` + `context-loader-utils.ts`, which import from here.

**`lib/views/`** owns virtual views end to end: SQL→IR→CTE inlining (`resolve.ts`), the dependency/security graph (`integrity.ts`), the context-save gate (`save-gate.server.ts`), column snapshotting/promotion (`prepare.server.ts`), and the read-side lookup (`views.server.ts` — `resolveViewsForContext`, `getViewsForPath`, `getAllViewsInTree`). It does **not** own where views are stored (a `ContextVersion.views` array) or how they reach a child context (the context loader).

**`lib/semantic/`** owns the semantic tier: spec→IR compilation (`compile.ts`), metric-SQL lexing and qualifier rewriting (`metric-sql.ts` — `lexMetricSql`, `rewriteMetricSql`), the reverse mapping (`detect.ts`/`detect-sql.ts`), the three validation tiers (`validate.ts` tier 1, `edit-check.ts` tier 2 + the shared EditFile entry point, `save-gate.server.ts` tier 3), scoped serving (`models.server.ts`/`models-client.ts`), and pure editor helpers (`infer-join.ts`, `infer-viz.ts`, `derive.ts`). It generates **no SQL** — only `QueryIR`; dialect correctness lives entirely in `lib/sql/`.

## Architecture

### Context read path

```
FilesAPI.loadFile(context)
  → context-loader.ts
      computeSchemaFromWhitelist()          (context-loader-utils.ts)
        parent's fullSchema × parent whitelist(childPaths, contextDir) = parentSchema
        parentSchema × own whitelist                                   = fullSchema
        inheritedBy(childPaths) then applyNameWhitelist(...)  → parentViews/fullViews,
                                                                parentSemanticModels/fullSemanticModels
      injectViewsAsTables()   → strips any INHERITED `_views` schema, then re-injects
                                this context's own views as tables under `_views`
                                (a connection the whitelist fold dropped for having no
                                 whitelisted real tables is RE-ADDED carrying `_views` alone)
      boundFullSchema(fullSchema)  → names-only when > CONTEXT_BUDGETS.contextParentSchemaChars, NEVER drops a table
      boundSchema(parentSchema)    → may additionally cap the table list (it is only the editor menu)
```

Inheritance has two halves, applied in this order at every level: `childPaths` on the view/model (the parent choosing who is offered it) and `viewWhitelist`/`semanticModelWhitelist` on the child version (the child's selection out of that; absent = `'*'` = take everything including future additions). Whatever survives both is what cascades further down. Views the ancestor's own loader disabled (`viewProblems`) are never passed on — that is what makes the security guarantee recursive without a global crawl.

**Only views and semantic models get both halves — the other inherited kinds are different, and assuming otherwise is the usual bug.** In `computeSchemaFromWhitelist`:

| Computed field | `childPaths` filter | Name whitelist | Merge |
|---|---|---|---|
| `fullSchema` / `parentSchema` | whitelist nodes carry it (`applyWhitelistToConnections(…, contextDir)`) | the version `whitelist` | table-level re-selection |
| `fullViews` / `fullSemanticModels` | yes (`inheritedBy`) | yes (`applyNameWhitelist`) | concat ancestor's inherited + ancestor's own |
| `fullDocs` | yes (`inheritedBy`) | **none** | concat |
| `fullMetrics` / `fullAnnotations` | **none** | **none** | concat |
| `fullSkills` / `fullAgents` | **none** | **none** | `mergeSkillsByName` / `mergeByName` — last group wins, so the nearer definition **shadows** the farther one |

Skills and agents are content-level rather than versioned, which is why they merge off `ancestorContent.skills`/`.agents` rather than the published version — a skill is live the moment it is saved, without a publish. `fullSkills` is only the *inherited* half: every consumer (`lib/tools/handlers/load-skill.ts`, `lib/chat/agent-args.server.ts`, `lib/hooks/useContext.ts`, `components/context/AgentsTabContent.tsx`) re-runs `mergeSkillsByName(content.fullSkills, content.skills)` so the context's own entry wins. Reading `fullSkills` alone silently drops every locally-authored skill.

There is no `excludedViews` field anywhere in the tree; the child-side selectors are `viewWhitelist` and `semanticModelWhitelist` only.

Two consequences of the chain being strict, both pinned by `lib/data/loaders/__tests__/context-inheritance-edge.test.ts`:

- **A grant must pass every level.** `childPaths` naming a nested folder (`/org/A/B`) does nothing unless every intermediate folder is also offered the item — an ancestor's `fullSchema` is the ceiling for everything below it, and a grant that skips the middle is simply unreachable. There is no pass-through and no warning; granting the intermediate subtree is the way to reach a deep folder.
- **Ancestor lookup matches the context's own directory, never a path prefix by length.** Sibling directories with same-length paths (`/org/ALFA` vs `/org/BETA`) are the shape that punishes anything looser — `findNearestAncestorContext` (`lib/data/loaders/context-loader-utils.ts`) compares the candidate's directory for equality.

`childPaths` values are physical folder paths, so **moving a folder rewrites them**: `FilesAPI.moveFile` runs `rewriteChildPathsForMove` (`lib/context/context-utils.ts`) over the contexts whose content mentions the old path (SQL-prefiltered via `DocumentDB.listByTypeContaining`, so a move never loads every context's content) — a deep walk keyed on the property name, so whitelist nodes at any nesting level, docs, views and semantic models are all covered without enumerating them, and prefix-similar sibling paths (`/org/a` vs `/org/ab`) are never touched. The path rewrite and the childPaths rewrites are applied as one SQL statement (`DocumentDB.applyFolderMove`), so a failure rolls the entire move back on every backend without client-side transaction machinery.

### Context write path — the two save gates

Every context write (view dialog, raw JSON editor, agent EditFile) lands in `FilesAPI.saveFile` (`lib/data/files.server.ts`), which for `type === 'context'` runs, in order:

```
validateFileStateServer()                       → structural (no-op for contexts)
stampAndValidateViews()      views/save-gate    → recompute reads, boundary, integrity, cycles
validateSemanticModelsGate() semantic/save-gate → tiers 1–3, stamp `verified`
```

The two gates are mutually dependent by design: `views/save-gate.server.ts` imports `semanticModelNames` from `semantic/save-gate.server.ts`, and the semantic gate imports `resolveViewsInSql` from `views/resolve.ts`. Views and semantic models share **one** name namespace (a semantic reference addresses a view by bare name), enforced from both directions.

Errors cross the boundary differently and that is a contract: `ViewSaveError` is one `;`-joined message; `SemanticModelSaveError.issues` is `\n`-joined so `SemanticModelsEditor` can attribute each issue to the model/metric row that caused it.

### The three validation tiers

One ladder, three purities. Each tier is a superset of the one above and each has exactly one entry point, so the agent's in-loop feedback and the publish gate can never drift.

| Tier | Entry point | Purity | Catches |
|---|---|---|---|
| 1 | `validateSemanticModel` (`lib/semantic/validate.ts`) | pure, sync | TypeBox shape gate, name/alias resolution, reserved aliases, lexed metric SQL, connection consistency, dimension/metric columns against the exposed field map |
| 2 | `compileProbeIssues` (`lib/semantic/edit-check.ts`) | pure, sync | structural compile failures tier 1 cannot see — it runs `compileSemanticQuery(probeSpec(model, metric), model)` for every metric |
| 3 | `runProbe` inside `validateSemanticModelsGate` (`lib/semantic/save-gate.server.ts`) | needs a live connector + server credentials | whatever only the engine knows: bad function names, non-aggregate expressions, type errors. Executes `SELECT * FROM (…) LIMIT 0` and stamps `verified` |

`semanticModelIssues` runs 1 then 2, and only runs 2 when 1 is clean. Tier 3 lives in the `server-only` gate deliberately: the agent's EditFile path runs in the **browser** and imports `edit-check.ts`, so it gets tiers 1–2 and the gate stays the authority.

### Tier 3: what the probe proves

**The tier-3 probe always carries a `GROUP BY`, and that is the entire aggregate-checking strategy.** With a grouping present, a non-aggregate metric expression is rejected by the engine's own GROUP BY validation — so there is no tier-1 aggregate-token whitelist to maintain, and dialect-specific aggregates (`MEDIAN`, `APPROX_COUNT_DISTINCT`, …) work without ever being listed. `probeSpec` (`lib/semantic/edit-check.ts`) supplies the model's first **non-m2m-sourced** dimension; an m2m probe dimension would drag a bridge CTE into a probe that only needs to validate one metric. When the model exposes no usable dimension, `runProbe` injects the grouping post-compile: the first exposed primary column, and as a last resort a constant (`SELECT 1 AS _probe_dim … GROUP BY 1`) for a view whose columns have not been snapshotted yet. Dropping the grouping in that last case would let a non-aggregate metric be stamped `verified` and fail at query time instead.

Probes for one save run through a worker pool of `PROBE_CONCURRENCY = 4` (`lib/semantic/save-gate.server.ts`), each bounded by the normal query timeout. A timeout or connector error is classified per metric against `INFRA_ERROR` and the remaining probes keep going, so one slow metric never aborts the rest and the save response aggregates every per-metric outcome.

### Semantic compile

**Relationships live inside the model — there is no relationships registry.** A `SemanticModelV2` (`lib/validation/atlas-schemas.ts`) is `{name, connection, primary, primaryKey?, references?, dimensions, metrics, childPaths?}`, and `references` is the whole join story: each entry carries its own `source` (a `SemanticSource` — `{kind:'table', schema?, table}` or `{kind:'model', view}`), a model-unique `alias`, and a `relationship` that discriminates the union. `many_to_one`/`one_to_one` join the primary directly through `on: [{primaryColumn, referencedColumn}]` with an optional `joinType` (default `LEFT`); `many_to_many` instead carries `through: {source, primaryOn: [{primaryColumn, bridgeColumn}], referencedOn: [{bridgeColumn, referencedColumn}]}`. Dimensions and metrics address a reference by its `alias` (`source: 'primary' | '<alias>'`), so the alias — not a global relationship id — is the join's only name. Two consequences: renaming an alias is a model-local edit, and a join is only ever emitted for a reference the query actually uses.

```
SemanticQuerySpec + SemanticModelV2
  → validateSemanticQuery()   (names resolve; ≤1 grouped m2m reference)
  → compileSemanticQuery()    → QueryIR
  → irToSqlLocal(ir, dialect) → SQL          (lib/sql)
  → resolveViewsInSql()       → SQL with `_views.*` inlined as CTEs
```

Compilation rules: `FROM` is `model.primary` (a table, or a data model addressed as `_views.<name>`); aggregation metrics become aggregate select columns aliased by `semanticAlias(name)`; ratio metrics become a raw `num * 1.0 / NULLIF(den, 0)`; SQL metrics pass through `rewriteMetricSql`, which rewrites only the `primary.` qualifier (reference aliases already *are* the compiled join aliases). Every used to-one reference contributes a `JoinClause` — including metric-only joins, discovered by lexing the metric SQL. `timeGrain` `DATE_TRUNC`s `spec.timeColumn` or the model's first primary temporal dimension. ORDER BY is time ASC when present, else first metric DESC; `limit` defaults to 1000.

Many-to-many compiles grain-preservingly and never through a plain join: a **grouped** m2m reference becomes a `SELECT DISTINCT` dedup-bridge CTE named `_m2m_<alias>` joined on every primary-key column (`_pk0.._pkN`), while a **filter-only** m2m becomes a correlated `EXISTS` / `NOT EXISTS`. Bridge and far sources are always aliased `_b`/`_f` inside the subquery — without that, a bridge that *is* the primary table makes the correlation a tautology that matches every row. Filters on an m2m alias never become outer conditions; a grouped alias filters inside its CTE (an outer condition would widen the CTE's `DISTINCT` grain and double-count).

### Detection (the reverse)

`semanticSpecFromIr(ir, models)` recovers a spec from parsed IR, then **recompiles it and compares**: `irEquivalent` canonicalizes select/group/join/filter alias-insensitively and order-insensitively. If the recompile does not reproduce the input, the result is discarded. Detection therefore yields false negatives, never false positives. `detect.ts` is pure (safe for client bundles); `detect-sql.ts` adds the WASM parser and is server/test-only — the browser calls `CompletionsAPI.sqlToIR` and then the pure detector (`lib/hooks/use-semantic-compat.ts`).

### View resolution at query time

View resolution is not open-coded per surface: `resolveQueryForExecution` (`lib/sql/governed-query.server.ts` — see `frontend/lib/sql/CLAUDE.md`) composes whitelist enforcement **and** view inlining, and the three executing surfaces (`app/api/query/route.ts`, the agent's `ExecuteQuery`, `lib/mcp/server.ts`) all call it. It calls `mentionsViews(query)`; if false the SQL is returned **byte-identical** and never parsed (existing queries keep their exact text, cache keys, and any exotic SQL the parser cannot handle). Otherwise `getViewsForPath` resolves the nearest context, and `resolveViewsInSql` does a depth-first walk of the `reads.views` graph (cycles and unknown views are hard errors), emits one CTE per view in topological order, and rewrites `_views.x` table refs — including inside the user's own CTE bodies, whose SQL the IR stores raw. A view's `whitelistedColumns` is enforced by **projection**: the body is wrapped so a deselected column ceases to exist. An explicit **empty** list means the view is OFF, and `resolveViewsForContext` drops it entirely — it is not in any schema and does not resolve, so naming it fails as an unknown view. (`resolve.ts` still renders a `WHERE 1 = 0` stub for an OFF view handed to it directly; nothing on the query path does that any more.)

## Interactions with other areas

| Boundary | Direction | Contract |
|---|---|---|
| `lib/data/files.server.ts` | calls in | `saveFile` runs both gates on every context write and converts gate errors to `UserFacingError`; `batchSaveFiles` routes through it, so it inherits them. `createFile` does not (see gotchas). |
| `lib/data/loaders/context-loader*.ts` | calls in | Uses `context-utils` (published version, skill merge), `name-whitelist`, `schema-bounding`, and `views/integrity` (`checkViewAvailability` at LOAD fails **open**; the gate passes `strictUnknownSchema` to fail **closed**). |
| `app/api/query/route.ts` | calls in | `resolveQueryForExecution` (the governance seam) composes whitelist validation and view resolution before execution; the route only calls `mentionsViews` → `getViewsForPath` → `resolveViewsInSql` directly on its no-`filePath` fallback branch. Guests reach this only by file id (`lib/query-cache/guest-query.server.ts`), never with raw SQL. |
| `app/api/semantic-models/route.ts` | calls in | One POST endpoint, four modes keyed by body shape: `testModel` (gate tiers 1–3, no save), `sql` (server-side detection), `q` (field search), else `tables` (scoped models; `[]` = unscoped, capped at 32 tables). |
| `lib/tools/handlers/edit-file.ts` | calls in | Agent EditFile on a context: `foldContextAgentView` → `changedSemanticModelIssues(next, saved)`; a non-empty result **rejects the edit wholesale** with per-issue feedback. `contextEditWithinBounds` is the safety net that a fold touched nothing else. |
| `lib/file-state/file-edit.ts` | calls in | Same check with `saved: undefined` — advisory, every model, never blocking. |
| `components/query-builder/SemanticExplorer.tsx` | calls in | `compileSemanticQuery` → `irToSqlLocal` in the browser; emits `(spec, sql, viz)` where the viz default comes from `infer-viz.ts` while `vizSettings.typeLocked` is falsy. |
| `components/context/SemanticModelsEditor.tsx` | calls in | The only consumer of `derive.ts` (draft pre-fill) and `infer-join.ts` (proposed join columns); runs `edit-check` locally and `models-client.testSemanticModel` for the Test button. |
| `agents/benchmark-analyst/db-tools.server.ts` | calls in | Headless mirror of the production path: `compileSemanticQuery` → `irToSqlLocal` → `resolveViewsInSql` → the real query executor. `ExecuteQuery` inlines `_views.*` before its cache; `SearchDBSchema` appends views via `viewsAsSchemaTables`. |
| `lib/sql/` | calls out | `sql-to-ir` / `ir-to-sql` / `ir-types` are the only dialect-aware layer; `schema-filter.ts` owns `applyWhitelistToConnections`. |
| `lib/connections/run-query.ts` | calls out | Tier-3 probes and view column snapshots execute through it (`SELECT * FROM (…) LIMIT 0`). |
| `orchestrator/prompts/prompts.yaml` | consumes | `skill_semantic_models` teaches the authoring format; `SCHEMA_TEMPLATE_VARS` injects the live content schemas so the prompt cannot drift from validation. |

## Gotchas

- **`verified` is server-managed.** `withPreservedStamps` destructures any client-sent `verified` away unconditionally. Tier 3 then behaves three ways: a clean probe stamps `true`; an error matching `INFRA_ERROR` (timeout/ECONNREFUSED/fetch failed/…) fails **open** — the save proceeds with `verified: false` and `probeScope` keeps that metric in every future probe set until it goes green; any other engine error **blocks** the save. A down warehouse must never make models uneditable.
- **Probe scope is a three-case diff.** Structural change (anything outside metric text and descriptions) → probe all metrics; metric-text-only → probe added/changed metrics (a pure deletion probes nothing); metadata-only → probe nothing. A ratio metric's "essence" resolves its aggregation metrics rather than naming them, so editing `Revenue` re-probes every ratio built on it. Comparison uses `sortedJson` (recursively key-sorted) because JSONB does not preserve key order and the agent's markup round-trip reorders keys.
- **A names-only schema makes every column look missing.** `boundFullSchema` strips columns from large schemas, and `content.fullSchema` reaching the browser is the bounded copy. `findTableFields` then returns an empty field map and tier 1 reports `column "x" is not an exposed field` for a perfectly good model (verified by running it). The guard is `fieldChecksTrustworthy` in `edit-check.ts`: when the client-side menu is bounded or absent, the EditFile path degrades to tier 2 only. The save gate is unaffected — it recomputes an unbounded schema from the whitelist.
- **Tier 1 opens with a shape gate.** `validateSemanticModel` runs TypeBox `Errors()` first (max 10, prefixed `malformed model — fix its shape first`) and returns immediately, because every rule below dereferences `primary`/`dimensions`/`references[].on` unguarded. Without it an LLM-authored model missing a field is a raw `TypeError` → HTTP 500 with no issue list.
- **The gates are on the update path only.** `FilesAPI.createFile` runs `validateFileState` and nothing else. In practice contexts are created empty (`makeDefaultContextContent`, fired automatically for every new folder), so there is normally nothing to gate — but a direct `POST /api/files` with `type: 'context'` and pre-populated `views`/`semanticModels` reaches the DB ungated. The next save through any path re-gates the whole document.
- **Context content is not Ajv-validated.** `validators` covers question/dashboard/story/notebook only; `validateFileState` handles config and connection by hand and returns `null` for everything else. Contexts are guarded by the two save gates instead.
- **`atlasSchema.$defs.ContextContent` is `ContextAgentContent`**, the agent's *flattened* view (live version's docs/metrics/annotations/semanticModels + content-level skills/evals) — not the stored version-based `ContextContent` in `lib/types/context.ts`. It exists in `$defs` for markup `$ref` resolution and the `schema_context` skill var, and is deliberately absent from the validation `oneOf`. The whitelist is absent from the agent's view entirely: any whitelist change fails `contextEditWithinBounds`.
- **m2m grain is enforced, not assumed.** `through.primaryOn` must join the primary on exactly `model.primaryKey` — same columns, same order — because the compiler keys the bridge join off `primaryOn`; a mismatch would silently compile at a different grain. `primaryKey` is required as soon as any reference is `many_to_many`.
- **Reserved names.** Reference aliases may not be `primary`, `_grain`, `_views`, `_probe`, or start with `_m2m_`. `semanticAlias` appends `_` to slugs on a BigQuery-superset reserved-word list, so a metric named "Rows" cannot emit `AS rows`.
- **Metric SQL is lexed, not parsed.** Every column reference must be qualified (`primary.x` / `<alias>.x`); bare identifiers, quoted identifiers, and references to an m2m alias are all tier-1 errors. The lexer is comment/string-aware, so parens and refs inside literals do not count — deliberately not the polyglot parser, which returns opaque `raw` columns for compound aggregates.
- **`mentionsViews` is a substring gate, not a parse.** `SELECT '_views.x'` trips it and takes the parse path needlessly; it can never miss a genuine reference.
- **"Expose the view and nothing else" is the canonical curated setup, and the whitelist fold alone deletes the view.** `applyWhitelistToConnections` drops a connection whose filtered schemas are empty, and `injectViewsAsTables` can only decorate connections that survived — a context exposing no real tables from a connection would lose the very view it exists to offer, with the query seam answering 403 for it while `SearchDBSchema` (which reads `version.views`, not `fullSchema`) went on describing it. Such a connection is therefore re-added carrying `_views` alone; the tables it hides stay hidden (`app/api/views/__tests__/query-route-views.test.ts`, "a VIEWS-ONLY context").
- **`_views` must never be INHERITED as a schema.** A child inherits its parent's `fullSchema`, and to the whitelist fold the parent's injected `_views` is just another schema — it rides down the tree, so a child that DECLINED a view would still carry it in its whitelisted schema. The query would then fail at resolution ("unknown view") rather than being refused, which reads like a bug in the view rather than the decline working. `injectViewsAsTables` therefore strips `_views` from every connection *before* injecting this context's own.
- **Views must be re-checked on inheritance, not just at save.** A parent narrowing its whitelist later DISABLES the dependent child view with a reason (`viewProblems`) rather than silently escalating it; `resolveViewsForContext` filters disabled views out so the query fails loudly.
- **`lib/context/dashboard-publish-highlights.tsx`** is a React `createContext` for dashboard publish highlighting — unrelated to knowledge-base contexts, sharing only the directory name.

## The agent's surface

Agents reach the semantic tier through one tool, `RunSemanticQuery`, defined in `agents/benchmark-analyst/db-tools.server.ts`. It is advertised alongside `ExecuteQuery` by `agents/analyst/analyst-agent.ts` and `agents/web-analyst/web-analyst.ts`, and registered for chat in `lib/chat/orchestration-core.server.ts`. (`analyst-agent.ts` re-exports only `SearchDBSchema` and `ExecuteQuery` for legacy importers — not this tool.) It takes a model name plus metrics, dimensions, filters, `timeGrain`/`timeColumn` and `limit` — never SQL, never a join — so an invalid join is unwritable by construction. It resolves models from the nearest context for the user's home folder (the same anchor chat uses), re-runs `validateSemanticQuery` against the *stored* model on **every** call so issues come back as structured tool errors the agent fixes in-loop, then compiles, inlines `_views.*` and executes through the same path as `ExecuteQuery`, returning that payload shape with `finalQuery` set to the compiled SQL. An unknown model name returns the list of available model names rather than a bare error.

Views reach the agent's *search* surface too: the production `SearchDBSchema` (same file) appends the nearest context's views as a `_views` schema entry — views are virtual, so the connection's introspected schema alone would leave a whitelisted view undiscoverable by schema search. The view→table projection is `viewsAsSchemaTables` (`lib/types/views.ts`), shared with the context loader's `injectViewsAsTables`, and the tool's per-run table whitelist applies to view tables like any other. A view's authored `description` rides along on the projected table (`SchemaTable.description`, the one field no connector introspects) and `lib/search/schema-search.ts` scores it at table weight — so a view can be found by what it is FOR, not only by its name.

Authored models are additionally projected into free-SQL prompt context as compact **unvalidated reference documentation** — primary source, references with their join columns, dimensions, and metric definitions (`semanticModelToNote` in `lib/sql/context-docs.ts`, reaching agents via `formatContextDocsSection`). Nothing there is validated or executed; it improves raw-SQL answers as soon as models exist, independently of whether anyone runs a semantic query.

## Design rules

**Many-to-many never becomes a plain join, and the shape it becomes is not arbitrary.** A filter-only m2m compiles to a **correlated** `EXISTS`, not `pk IN (SELECT …)`, for two reasons: `IN` cannot carry multiple columns on BigQuery, so a composite primary key has no uncorrelated form, and `NOT EXISTS` is NULL-safe where `NOT IN` is not. Negation rides on the outside — a negated filter renders its operator **positively** inside the subquery (`!=` becomes `=`) and flips `EXISTS` to `NOT EXISTS`, so `!=` means *has no related row matching the positive condition*; `IS NULL` / `IS NOT NULL` on an m2m dimension mean has-no-related-row / has-one and emit no far-table predicate at all. Join type for a grouped m2m follows the same logic: an alias carrying filters joins `INNER` (the filter restricts the primary set, matching filter-only semi-join semantics), an unfiltered alias joins `LEFT` so unmatched primary rows appear once under a `NULL` dimension group rather than silently vanishing.

**Connection consistency is checked at save, not discovered at runtime.** The primary and every reference source — tables and data models alike, including an m2m bridge source — must resolve on the model's single `connection`; cross-connection joins cannot compile at all, so tier 1 rejects a mismatch with a pointing error (`lib/semantic/validate.ts`) instead of letting it surface as a confusing engine failure in tier 3. In the editor the connection is implied by the per-database section, so this is mainly a server-side backstop for hand- and agent-authored model JSON.

The three levels stay acyclic by construction rather than by a cycle check: `SemanticSource` is `{kind:'table'}` or `{kind:'model', view}` and nothing else. Data models reference tables and other data models; semantic models reference tables and data models; **nothing can reference a semantic model.** That is why the semantic tier needs no dependency graph of its own while `lib/views/` does.

## Key files

| Task | File |
|---|---|
| Add/change a file content field | `lib/validation/atlas-schemas.ts` (everything else re-derives on next module load) |
| Change what the LLM is told a file's content looks like | `lib/validation/atlas-json-schemas.ts` (`stripVizDeep`, `SCHEMA_TEMPLATE_VARS`) |
| Debug a "Invalid file content" save error | `lib/validation/content-validators.ts` (`formatErrors`, cross-field checks) |
| Understand spec → SQL | `lib/semantic/compile.ts` |
| Understand SQL → spec ("why isn't the Semantic tab lighting up?") | `lib/semantic/detect.ts` (recompile-and-compare gate) |
| Add a model authoring rule | `lib/semantic/validate.ts` (tier 1) or `lib/semantic/edit-check.ts` (tier 2 + EditFile entry) |
| Change what blocks a context save | `lib/semantic/save-gate.server.ts`, `lib/views/save-gate.server.ts` |
| Change how a view becomes SQL | `lib/views/resolve.ts` |
| Change the view security boundary | `lib/views/integrity.ts` (`computeViewReads`, `checkViewAvailability`) |
| Change what the agent sees/edits on a context | `lib/context/context-agent-view.ts` |
| Change inheritance selection | `lib/context/name-whitelist.ts`, `lib/types/context.ts` (`NameWhitelist`) |
| Tune prompt/schema size | `lib/context/context-budgets.ts`, `lib/context/schema-bounding.ts` |
| Find a domain type | `lib/types.ts` (barrel) → `lib/types/{context,views,semantic}.ts` |

---
