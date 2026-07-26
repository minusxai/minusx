# lib/sql — SQL text ↔ IR, and everything that rewrites a query before it runs

## What this module does

Owns every **static** transformation of SQL text: parse to a structured IR and back, the rewrites
applied on the execute path, parameter extraction/assembly, static analysis for the editor, and the
table-whitelist check. See the pointer table at the bottom for file-level routing.

It does **not** execute anything (that is `lib/connections/`), does not cache (`lib/query-cache/`),
and does not decide *what* query to write (`lib/semantic/`, `lib/views/`, the agents). Several files
in this directory are misfiled — see "Not the SQL pipeline" below.

**Parsing is server-side.** `parseSqlToIrLocal`, `validateSqlLocal`, `inferColumnsLocal` and
`getCompletionsLocal` all `await init()` on the `@polyglot-sql/sdk` WASM build, and every importer
is a server module or an API route. The browser never runs the parser: `lib/data/completions/completions.ts`
reaches it over same-origin routes (`/api/sql-to-ir`, `/api/ir-to-sql`, `/api/autocomplete`,
`/api/validate-sql`, `/api/infer-columns`). **Generation is not** — `ir-to-sql.ts` imports nothing
but its own types, so `irToSqlLocal` is synchronous, dependency-free, and callable in the browser
(`components/query-builder/SemanticExplorer.tsx` does exactly that).

## Architecture

The IR is a **shared contract**, not private to this module. `lib/semantic/compile.ts` builds
`QueryIR` from scratch and `lib/views/resolve.ts` rewrites one; other `irToSqlLocal` callers include
`lib/semantic/save-gate.server.ts`, `lib/data/completions/completions.server.ts`,
`agents/benchmark-analyst/db-tools.server.ts`, `components/query-builder/SemanticExplorer.tsx`, and
`app/api/ir-to-sql/route.ts`. `ir-to-sql.ts` has **no `never` exhaustiveness guard** (unlike the viz
bridge), so adding a field to `ir-types.ts` without a matching case there compiles fine and silently
drops the field for every one of those callers.

The execute path parses the SQL on several independent paths, and the round-trips are **not**
equivalent:

```
POST /api/query (app/api/query/route.ts)
  if (filePath): getWhitelistForPath → validateQueryTables    ← before any cache is served
  resolveViewsInSql (only if the SQL mentions _views)         ← IR round-trip #0
  getCachedJsonlStream(query = post-views SQL, params = with nulls)
      └─ execute thunk (miss / expired / revalidate only)
           applyNoneParams (only if some param is null)
                → parseSqlToIrLocal → removeNoneParamConditions
                → irToSqlLocal → regex NULL-substitution      ← IR round-trip #1
           runQueryStream (lib/connections/run-query.ts)
             enforceQueryLimit: always parses; regenerates only to
               add a missing LIMIT or cap one over MAX_LIMIT  ← AST round-trip #2
             connector binds params, returns inlineSqlParams(...) as finalQuery
```

**#0 and #1 go through this module's IR** (`sql-to-ir.ts` → `ir-to-sql.ts`) and carry the silent
losses catalogued below. **#2 does not** — `limit-enforcer.ts` mutates polyglot's own AST and calls
the SDK's `generate`, which preserves `RIGHT JOIN`, `FILTER (WHERE …)`, parenthesized filter groups,
quoted identifiers and `:param` placeholders. Do not reason about #2 using the #0/#1 loss list.
`validate-query-tables.ts` also parses (SDK AST, read-only — it never regenerates), so it is neither
a round-trip nor an IR consumer.

The cache key is computed over the SQL **before** `applyNoneParams` and over the params dict **with
its `null`s intact** — that transform lives inside the execution thunk. `_views` resolution happens
before the cache, so editing a view body invalidates for free.

Param values compose upstream of all of this, in `sql-params.ts`: `buildQueryParamValues` assembles
the dict from a question's declared params plus dashboard/story overrides;
`noneifyEmptyNumericParams` re-applies the empty-numeric rule at the `useQueryResult` chokepoint
(`lib/hooks/file-state-hooks.ts`); `bindReferencedParams` derives params straight from the SQL for
inline `<Number query>` story embeds. Server-side, only `null` is None — `''` is a real value
forwarded to the connector.

`lib/file-state/file-state.server.ts` runs the same `applyNoneParams` for headless/server file
execution, so browser and server agree on None semantics. It does **not** resolve views.

## Gotchas

**The IR round-trip silently deletes predicates it cannot model.** `parseSingleCondition`
(`sql-to-ir.ts`) returns `null` for any predicate shape it has no case for, and
`parseFilterExpression` does `if (cond) conditions.push(cond)` — no throw, no warning, the
condition just disappears from the regenerated SQL. Confirmed instances: an **explicitly
parenthesized** subexpression (`WHERE (a = 1 OR b = 2) AND c = 3` → `WHERE c = 3`), `IN` with a
function on the left (`COALESCE(mode,'org') IN (...)`), `:p IS NULL`, and `NOT (...)`. Treat the
general rule as the invariant; the list is not exhaustive.

It is **not** "OR is lossy": precedence-implied nesting survives (`a = 1 AND b = 2 OR c = 3`
re-emits as `(a = 1 AND b = 2) OR c = 3`). The discriminator is an explicit paren wrapper node in
the source. The docstring in `lib/database/__tests__/credit-dashboard-seed.test.ts` says
"top-level OR groups" — that wording is wrong; the test's assertions are right.

**`validateSqlForGui` is not a safety net.** It runs unless a caller explicitly passes
`enforceGuiCompatibility: false` (only `lib/views/integrity.ts` does, and it never round-trips),
and rejects subqueries, window functions, BETWEEN, NOT IN/LIKE/ILIKE, regex, and arithmetic/CAST
inside comparisons — but that gate exists to decide *what the visual query builder can edit*, not
what survives a round-trip. Every silent-loss form above passes it cleanly; `checkComplexFilters`
only walks the comparison keys (`eq`/`neq`/`gt`/`lt`/`gte`/`lte`/`like`/`ilike`) and never inspects
`in`.

**The authoring rule that follows from this**: a *comparison* operator with a function on the left
survives — `parseComparison` falls through to `raw_column` (verbatim generated SQL) and
`generateFilterCondition` re-emits it — but `IN` with a function on the left is deleted, because
`parseInCondition` requires `inExpr.this?.column` and returns `null` otherwise. This is why the
seeded Credit Usage SQL expresses its mode scoping as `COALESCE(e.mode,'org') <> 'internals'` and
not `COALESCE(...) IN (...)`: the parser is unchanged, so the safe form must be written by hand.
(Distinguish `raw_column` — left side, produced by the parser, the survival mechanism — from
`raw_sql` on `FilterCondition`, which is whole-predicate, written only by the semantic compiler,
and never produced by the parser.)

**Two gates arm the IR path; both are easy to trip.** `applyNoneParams` returns early when no param
is `null`, and `resolveViewsInSql` returns the SQL byte-identical (never even parsed) unless it
mentions `_views`. So a query with all params valued and no view reference never reaches the IR —
but **one** None param, or **one** `_views.` reference, opts the entire WHERE clause into it. Note
this says nothing about `enforceQueryLimit`, which parses every SELECT regardless and regenerates
whenever the query carries no LIMIT.

**Opposite failure mode: `= NULL` returns zero rows.** When the parse throws (BETWEEN, NOT IN,
CAST…) or the IR is compound (`UNION` — `applyNoneParams` skips the IR branch outright), the
fallback regex substitutes literal `NULL` for the placeholder. `a = NULL` is never true, so a None
param that should mean "no filter" instead filters everything out.

**Other confirmed IR losses** (any query reaching round-trip #0 or #1): `RIGHT JOIN` is dropped
entirely by `parseJoins` (only INNER/LEFT/FULL are kept — the joined table vanishes, wrong
semantics, no error), aggregate `FILTER (WHERE …)` is dropped (`SUM(a) FILTER (…)` → `SUM(a)` —
wrong numbers), `OFFSET`, `NULLS LAST`, and comments are dropped; quoted identifiers lose their
quotes (`AS "Weird Name"` → invalid SQL, at least loud); and `x IN (:p)` becomes `x IN (':p')` —
the placeholder literalized into a string.

**`enforceQueryLimit` has a guard `applyNoneParams` lacks**: when a LIMIT already exists and is
within bounds it returns the **original** SQL untouched, so the common path never regenerates.
Regeneration is guarded on both sides: `regenerateSql` returns `null` on failure and callers fall
back to the original SQL rather than emitting `JSON.stringify(ast)`
(`__tests__/limit-enforcer-regression.test.ts`), and the `$param → :param` restore pass runs through
the quote-aware scanner in `restoreParamPlaceholders`, so `$`-prefixed JSON keys inside string
literals survive (`__tests__/limit-enforcer-json-path.test.ts`).

**Param names are a regex-injection surface.** `applyNoneParams` builds ``new RegExp(`:${p}\b`, 'g')``
per None param, and guests control param names on public pages. `isValidParamName` gates this and
invalid-named params are dropped *entirely* (not just skipped) before any regex is built —
`__tests__/none-params-safety.test.ts` is the guard. Never relax it. (The `\b` is load-bearing too:
without it `:foo` would match inside `:foobar`. The docstring at the top of that test file omits it
and is wrong on this detail.)

**Whitelist enforcement is double-conditional and fails open.** `getWhitelistForPath` +
`validateQueryTables` run in `app/api/query/route.ts` **before any cached result is served**, because
the cache key omits `filePath` — skipping them would let a user replay a query authorized elsewhere.
But they only run when the request carries a `filePath` **and** the resolver returns a non-null
whitelist, and there are three fail-open holes: `getWhitelistForPath` swallows every error to `null`
(= unrestricted), a wildcard context chain also returns `null`, and `validateQueryTablesLocal`
returns `null` (= allowed) on any parse failure — while parsing with the dialect hardcoded to
`duckdb`, so valid BigQuery/Postgres syntax that duckdb rejects is allowed through unchecked.
Agent/MCP-style calls with no `filePath` are never table-checked here; whatever authorizes them must
do so upstream.

**`inline-params.ts` is display-only.** It produces `QueryResult.finalQuery`; the engine gets a
prepared statement with separately bound values, so the two can differ in edge cases.

**Test-coverage honesty.** `__tests__/sql.test.ts` covers the *supported* round-trip surface well
and `store/__tests__/noneParamIRe2e.test.ts` drives the None path through the real
`app/api/query/route.ts` handler with a mocked connector — but none of the silent losses above have
unit coverage. The only live regression guard is the seed tripwire in
`lib/database/__tests__/credit-dashboard-seed.test.ts`. If you change `sql-to-ir.ts` or
`ir-to-sql.ts`, add the case; the suite will not catch you.

## Not the SQL pipeline (but living here)

`schema-filter.ts`, `whitelist-resolver.server.ts`, `context-docs.ts`, `annotation-notes.ts`,
`mention-completions.ts`, and `param-type-display.ts` are context/whitelist/prompt-budget/chat
concerns that merely sit in this directory — `mention-completions.ts` and `param-type-display.ts`
do no SQL parsing at all. `getWhitelistForPath` + `validateQueryTables` are the one genuine coupling
to the execute path (see the whitelist gotcha above). Budgets for `context-docs.ts` and
`annotation-notes.ts` come from `lib/context/context-budgets.ts`.

## Code pointers

| Task | File |
| --- | --- |
| IR shape / add a field | `ir-types.ts` (then `ir-to-sql.ts` **and** `sql-to-ir.ts`) |
| SQL → IR; what the GUI refuses to parse | `sql-to-ir.ts` (`validateSqlForGui`, `parseSingleCondition`) |
| IR → SQL; a clause emits wrong | `ir-to-sql.ts` |
| None param drops/keeps the wrong filter | `none-params.ts` + `ir-transforms.ts` |
| Row caps, `$param` mangling, JSON blobs as SQL | `limit-enforcer.ts` |
| Param extraction / value assembly / empty-vs-None | `sql-params.ts` |
| `finalQuery` display string | `inline-params.ts` |
| Monaco completions, dialect qualification | `autocomplete.ts` |
| `@`/`@@` chat mentions | `mention-completions.ts` |
| Result column names/types without executing | `infer-columns.ts` |
| Editor syntax errors | `validate-sql.ts` |
| Table allowlist enforcement | `validate-query-tables.ts`, `whitelist-resolver.server.ts` |
| Whitelist tree → visible schema | `schema-filter.ts` |
| Agent-facing Schema Notes / Context Library | `context-docs.ts`, `annotation-notes.ts` |
| Execute-path wiring | `app/api/query/route.ts`, `lib/connections/run-query.ts`, `lib/file-state/file-state.server.ts` |
| Round-trip contracts (supported surface only) | `__tests__/sql.test.ts`, `store/__tests__/noneParamIRe2e.test.ts`, `lib/database/__tests__/credit-dashboard-seed.test.ts` |
