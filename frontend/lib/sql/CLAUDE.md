# SQL and the query IR

Pure text and AST work — **no I/O**, no state. SQL ↔ `QueryIR` round-tripping, parameter extraction
and value assembly, the None semantics, LIMIT enforcement, table allowlisting and whitelist→schema
filtering, autocomplete and mention completion, output-column inference, and the agent-facing
Schema-Notes / context-doc rendering. Nothing here talks to a driver. Two files carry
`import 'server-only'` because they read context documents — `whitelist-resolver.server.ts` and,
despite its name, `validate-query-tables.ts`; everything else is importable from the browser, a
script or a test, and should stay that way.

This module holds the subtlest correctness traps in the repo: a filter that silently widens returns
MORE rows with no error, which no test notices unless it is written to.

The two siblings in the same data plane have their own docs — `frontend/lib/connections/CLAUDE.md`
(driver contact, the connectors, the row-cap seam) and `frontend/lib/query-cache/CLAUDE.md` (the
durable SWR + lease + blob cache). Callers reach into this module from both sides:
`lib/connections/run-query.ts` calls `enforceQueryLimit`, `app/api/query/route.ts` calls
`applyNoneParams` and `validateQueryTables`, and `lib/query-cache/guest-query.server.ts` calls
`isValidParamName`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## SQL ↔ IR

`parseSqlToIrLocal(sql, dialect, opts)` wraps `@polyglot-sql/sdk` (WASM) and projects its AST onto the
hand-written `QueryIR` / `CompoundQueryIR` shapes in `ir-types.ts`. By default it enforces GUI
compatibility (`validateSqlForGui`) and throws `UnsupportedSQLError` for subqueries, window functions,
`BETWEEN`, `NOT IN`/`NOT LIKE`/`NOT ILIKE`, regex operators, and complex expressions inside filters —
arithmetic, `CAST`, and any function outside the allowed set (`ROUND`, `SPLIT_PART`, the `DATE_TRUNC`
family, the five aggregates). The NOT and complex-expression checks only walk `WHERE`/`HAVING`;
everything else is a substring scan of the stringified AST. `lib/views/integrity.ts` opts out with
`enforceGuiCompatibility: false` because it only wants table dependencies. `irToSqlLocal` regenerates
SQL from the IR **by hand** — `ir-to-sql.ts` imports nothing from the SDK, so IR→SQL never calls WASM
`generate`.

Callers: `none-params.ts` (round-trips whenever any param is None), `lib/views/resolve.ts` (round-trips
whenever the SQL mentions `_views.`), `lib/data/completions/completions.server.ts` (the GUI query
builder), `lib/semantic/{compile,save-gate.server,detect-sql}.ts` (compiles a semantic spec straight to
`QueryIR`, then generates), `agents/benchmark-analyst/db-tools.server.ts`, and the
`app/api/sql-to-ir` / `app/api/ir-to-sql` routes.

## What the round-trip preserves and what it silently drops

Verified by running `parseSqlToIrLocal` + `irToSqlLocal` (duckdb dialect) on each input. Preserved:
`DISTINCT`, aliases, joins (including a verbatim `raw_on_sql` for non-equi `ON`), `IS [NOT] NULL`,
CTE bodies (stored as raw SQL), `GROUP BY` ordinals (resolved to names), aggregates, `HAVING`,
`ROUND(...)` wrappers, `DATE_TRUNC`/`DATE`/`SPLIT_PART`, raw column expressions (`lower(city)`), and
`:param` references in scalar comparisons. Dropped or corrupted:

| Input | Output | Consequence |
|---|---|---|
| `WHERE (x = 1 AND y = 2)` | `WHERE x = 1 AND y = 2` | redundant parens normalized away (harmless) |
| `SELECT "Weird Col" FROM "My Table"` | `SELECT Weird Col FROM My Table` | quoting lost → invalid SQL |
| `WHERE c IN (:s)` | `WHERE c IN (':s')` | placeholder becomes a string literal |
| `FROM db.sch.t` | `FROM sch.t` | catalog qualifier lost |
| `LIMIT 10 OFFSET 5` | `LIMIT 10` | `OFFSET` dropped |
| `ORDER BY a NULLS LAST` | `ORDER BY a` | null ordering dropped |
| `… UNION ALL … ORDER BY 1 LIMIT 3` | `… UNION ALL … LIMIT 3` | ordinal `ORDER BY` dropped |
| comments, trailing `;`, original formatting | normalized | cosmetic only |

These losses are invisible most of the time because **the round-trip only happens when it has to**:
`applyNoneParams` passes the SQL through verbatim unless at least one param is None, and view
resolution takes a byte-identical fast path unless the SQL mentions `_views.`.

**Parenthesized groups used to be dropped, and the failure mode is worth remembering.** It was
silent: `validateSqlForGui` does not check for the `paren` AST node, so the parse *succeeded*;
`parseFilterExpression` switched on the first AST key, a `paren` node was neither `and` nor `or`, it
fell to `parseSingleCondition`, which returned `null`, and the condition was discarded. A filter
silently *widening* — more rows, no error — is the worst thing this layer can do. `unwrapParen` now
unwraps before dispatch and refuses to flatten a same-operator parenthesized child (which would
rebind precedence), so `WHERE (x = 1 OR y = 2) AND c = 3` survives byte-identical.
`lib/sql/__tests__/where-paren-groups.test.ts` pins it, including through `applyNoneParams`.

## Param semantics

`sql-params.ts` is the single source for `:name` extraction (SQLAlchemy's regex, with a lookbehind that
skips `::casts`, `\:` escapes and word-char-preceded colons like `10:30:00`; it does **not** skip
placeholders inside string literals or comments) and for value assembly. `buildQueryParamValues` is
the canonical assembler: external (dashboard/story) values beat the question's saved values, a missing
number defaults to `null` and a missing text to `''`, empty-string-for-a-number coerces to `null`, and
a numeric-typed string is converted to a real number so `:p * INTERVAL '1 week'` does not blow up.
`bindReferencedParams` is the type-agnostic variant for inline `<Number query>` story embeds, which
declare no parameter list; it must stay a pure function of `(query, values)` so the renderer and the
server-side augmentation produce identical params and therefore identical query hashes.

`applyNoneParams` then implements None in **two prune passes, then a regex**. First the editable-`QueryIR`
round-trip, which it skips outright for a compound (UNION) query. Then
`removeNoneParamConditionsFromSqlAst` (`lib/sql/sql-to-ir.ts`) over the parser's *native* AST, walking
every `select` node's `where_clause` and `having` — inside CTEs, inside each UNION branch, inside
scalar subqueries — dropping any predicate leaf that mentions a None param and collapsing the
enclosing AND/OR (and the `paren` wrapper around it); it regenerates only when it actually changed
something, so it is a no-op for what the IR pass already handled. Only then are surviving `:p`
occurrences replaced with `NULL` by regex and None entries stripped from the values dict. The second
pass exists because a None param inside a CTE or a UNION branch used to fall through to the regex and
become `WHERE c = NULL` — never true, so the embed returned **zero** rows instead of all of them, the
exact inverse of what None means. Both passes are individually `try`-wrapped: a parse or generation
failure degrades to plain `NULL` substitution rather than failing the query.

So None means *the predicate is removed*, not *the predicate compares against NULL*. Taken to its
conclusion, `applyNoneParams("SELECT a FROM t WHERE COALESCE(:s,'')='' OR c = :s", {s: null})` yields
`SELECT a FROM t` with an empty params dict — every arm referenced `:s`, so the whole WHERE goes and
the query returns every row. That is the intended reading of "no filter".

Param names are validated as identifiers *before* any `RegExp` is built (`isValidParamName`) — guests
control param names on public pages, so a metacharacter name is a ReDoS/injection vector. Names that
fail are dropped entirely, not escaped. Pinned by `lib/sql/__tests__/none-params-safety.test.ts`.

## Row caps

`enforceQueryLimit` adds `LIMIT 1000` (`DEFAULT_LIMIT`) when absent and clamps an explicit limit above
`MAX_LIMIT` (10000). For a plain `SELECT` it returns the **original string untouched** when a limit is
already in range — regenerating valid SQL through the parser has caused real corruption (JSON
`$`-path keys rewritten to `:param`), and most agent queries already carry a LIMIT. A compound
(`UNION`/`INTERSECT`/`EXCEPT`) query regenerates whenever it has a limit at all, and appends
`LIMIT 1000` as text when it has none, because polyglot cannot attach a limit to a compound node.
When it must regenerate, `restoreParamPlaceholders` converts the dialect-native placeholder (`$p`,
`@p`, `%(p)s`) back to `:name` only outside string and identifier literals. Parse failures and
non-`SELECT` roots are no-ops, which is what makes it safe to apply unconditionally inside
`runQueryStream` (see `frontend/lib/connections/CLAUDE.md`). Mongo has its own mirror,
`enforceMongoLimit`, because this is a SQL parser.

## The governed query seam

`governed-query.server.ts` is the ONE place that decides whether a piece of user- or agent-authored
SQL may run and what it executes as. `resolveQueryForExecution({sql, connectionName, user, anchor})`
composes, in a fixed order: whitelist resolution → `validateQueryTables` → dialect → `_views.*`
inlining. It throws `WhitelistViolationError` or `ViewResolutionError`; otherwise it returns
`{executedQuery, dialect, schemaContext}`.

**It exists because per-surface enforcement drifted, three times.** `/api/query` validated and
inlined; MCP validated but never inlined (a view reference reached the warehouse as a nonexistent
table); the agent's `ExecuteQuery` did neither — so a table withheld from a workspace still returned
rows through the agent's tool while the browser answered 403 for the same SQL. **Concealment is not
enforcement**: not showing a table to a model is no protection once the model names it anyway.
The three callers are `app/api/query/route.ts`, `agents/benchmark-analyst/db-tools.server.ts`
(`ExecuteQuery._executeFallback`) and `lib/mcp/server.ts`.

**Validation precedes inlining, deliberately.** A view is authorized as *itself* — it appears in the
whitelisted schema, so a curated view may expose an aggregate over tables the caller cannot query
directly, and its own SQL is validated where it is authored (the context save gate). Validating the
inlined text would reject exactly the case views exist for. Inlining precedes execution *and* caching
so cache keys are computed over the resolved SQL.

**The `QueryAnchor` is required, not inferred**, because the surfaces genuinely differ and the
difference used to be accidental: `{kind:'file', path}` governs a question by the nearest context to
**its own path** (what makes a locked-down team folder lock its questions down), `{kind:'homeFolder'}`
governs free-form chat and MCP, which have no file in hand.

**Metadata is whitelisted too.** The suggestion surfaces (`lib/data/completions/completions.server.ts`
— mentions, table and column suggestions) resolve the whitelist server-side through
`getWhitelistForPath` and filter the connection schema before answering. A client-supplied
`whitelistedSchemas` is now only a **narrowing** applied on top; it used to be the source of truth,
so a caller that omitted it got the entire warehouse. `/api/autocomplete` is exempt by construction:
it completes against schema the client already sent, so it can reveal nothing new.

**Known gap — ad-hoc SQL is not whitelist-checked.** `/api/query` with no `filePath` (the `/explore`
editor) has no anchor and runs unvalidated. Closing it naively re-introduces the dashboard
"Failed to fetch" storm: resolving a whitelist loads the context chain, which loads connection files,
which runs the connection loader — schema profiling on the query hot path, which
`app/api/query/__tests__/query-route-no-profiling.test.ts` exists to prevent. The fix is a
profiling-free resolver: read the context RAW (`skipEnrichment`) and validate against the whitelist
TREE, which needs no connection schema at all. Pinned as characterization in
`app/api/views/__tests__/query-route-views.test.ts`.

**`eslint.config.mjs` enforces the boundary** (`RESTRICT_RUN_QUERY`): importing
`@/lib/connections/run-query` is an error outside the allowlist block at the bottom of that config —
the governed surfaces, plus the paths that run already-validated SQL (semantic tier-3 probes, view
column snapshots, saved-question execution). A new surface cannot silently skip governance.

**`null` and `[]` are opposites, and the distinction is load-bearing.** `null` means genuinely
unrestricted — a `*` chain to the root, no context at all, or a lookup failure (which must never
block execution). `[]` means *this context exposes nothing for this connection* and denies
everything. Both `getWhitelistForPath` and `validateQueryTablesLocal` observe it: the resolver
returns `[]` once it knows the chain is not all-wildcard and the connection resolves to no schemas,
and the validator only short-circuits on a nullish whitelist, never on an empty one.

Conflating them was a fail-open — an admin's "expose nothing" silently became "expose everything",
the exact inverse of the request, on an access-control decision. The consequence of the fix is worth
knowing: **in a workspace that curates explicitly, a connection added later is not queryable until
some context whitelists it.** That is what an explicit list means, and it now fails loudly instead of
quietly granting access nobody granted.

## Whitelisting and schema exposure

`validateQueryTables` (`validate-query-tables.ts`) extracts table references and rejects anything
outside the whitelist. **It always parses as `duckdb`**, whatever the connection type, and a parse
failure *allows the query through* — the execution layer surfaces the syntax error instead of this
layer inventing one.

`getWhitelistForPath` (`whitelist-resolver.server.ts`) **never throws**: any lookup failure returns
`null`, which means *unrestricted*. A chain of `'*'` whitelists up to the root also returns `null`
rather than enumerating a possibly-stale cached schema. Callers must read `null` as "no restriction",
not "nothing allowed".

`schema-filter.ts` is the read side of the same data: `getWhitelistedSchemaForUser` narrows a
connection's cached schema to what the caller may see, and `context-docs.ts` (`resolveContextDocs` /
`formatContextDocsSection`, budgeted via `annotation-notes.ts`) renders the Schema-Notes block. Both
are consumed by `lib/chat/agent-args.server.ts` and `lib/hooks/useContext.ts` to build the schema
context handed to agents and the right sidebar — so widening a whitelist widens what the LLM sees.

## Key files

| Task | File |
|---|---|
| SQL → IR, the GUI-compat gate, native-AST None pruning | `lib/sql/sql-to-ir.ts` |
| IR → SQL (hand-written, no WASM generate) | `lib/sql/ir-to-sql.ts` |
| The IR shapes and the transforms over them | `lib/sql/ir-types.ts`, `lib/sql/ir-transforms.ts` |
| None-param semantics | `lib/sql/none-params.ts` |
| `:param` extraction + value assembly | `lib/sql/sql-params.ts` |
| Row caps | `lib/sql/limit-enforcer.ts` |
| Authorize + rewrite a query before executing it | `lib/sql/governed-query.server.ts` (every executing surface calls this) |
| Table allowlisting | `lib/sql/validate-query-tables.ts`, `lib/sql/whitelist-resolver.server.ts` |
| Whitelist → exposed schema | `lib/sql/schema-filter.ts` |
| Agent-facing Schema Notes / context docs | `lib/sql/context-docs.ts`, `lib/sql/annotation-notes.ts` |
| Editor autocomplete / chat mentions | `lib/sql/autocomplete.ts`, `lib/sql/mention-completions.ts` |
| Syntax check, output-column inference | `lib/sql/validate-sql.ts`, `lib/sql/infer-columns.ts` |
| Display-only param inlining (`QueryResult.finalQuery`) | `lib/sql/inline-params.ts` |
| Param type icon/colour (React-adjacent, kept out of `sql-params.ts`) | `lib/sql/param-type-display.ts` |
