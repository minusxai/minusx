# SQL and the query IR

Pure text and AST work — **no I/O**. SQL ↔ `QueryIR` round-tripping, parameter handling, the None
semantics, view inlining, autocomplete and mention completion. Everything here is called by
`frontend/lib/connections/` and `frontend/lib/query-cache/`; nothing here talks to a driver.

This module holds the subtlest correctness traps in the repo: a filter that silently widens returns
MORE rows with no error, which no test notices unless it is written to.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## SQL ↔ IR

`parseSqlToIrLocal(sql, dialect, opts)` wraps `@polyglot-sql/sdk` (WASM) and projects its AST onto the
hand-written `QueryIR` / `CompoundQueryIR` shapes in `ir-types.ts`. By default it enforces GUI
compatibility (`validateSqlForGui`) and throws `UnsupportedSQLError` for subqueries, window functions,
`BETWEEN`, `NOT IN`/`NOT LIKE`/`NOT ILIKE`, regex operators, and arithmetic/cast expressions inside
filters. `lib/views/integrity.ts` opts out with `enforceGuiCompatibility: false` because it only wants
table dependencies. `irToSqlLocal` regenerates SQL from the IR by hand (no WASM generate).

Callers: `none-params.ts` (round-trips whenever any param is None), `lib/views/resolve.ts` (round-trips
whenever the SQL mentions `_views.`), `lib/data/completions/completions.server.ts` (the GUI query
builder), `lib/semantic/*` (compiles a semantic spec straight to `QueryIR`, then generates), and the
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
skips `::casts` and `10:30:00`; it does **not** skip placeholders inside string literals or comments)
and for value assembly. `buildQueryParamValues` is the canonical assembler: external (dashboard/story)
values beat the question's saved values, a missing number defaults to `null` and a missing text to
`''`, empty-string-for-a-number coerces to `null`, and a numeric-typed string is converted to a real
number so `:p * INTERVAL '1 week'` does not blow up. `bindReferencedParams` is the type-agnostic
variant for inline `<Number query>` story embeds, which declare no parameter list.

`applyNoneParams` then implements None in **two prune passes, then a regex**. First the editable-`QueryIR`
round-trip, which it skips outright for a compound (UNION) query. Then
`removeNoneParamConditionsFromSqlAst` (`lib/sql/sql-to-ir.ts`) over the parser's *native* AST, walking
every `select` node's `where_clause` and `having` — inside CTEs, inside each UNION branch, inside
scalar subqueries — dropping any predicate leaf that mentions a None param and collapsing the
enclosing AND/OR; it regenerates only when it actually changed something, so it is a no-op for what
the IR pass already handled. Only then are surviving `:p` occurrences replaced with `NULL` by regex
and None entries stripped from the values dict. The second pass exists because a None param inside a
CTE or a UNION branch used to fall through to the regex and become `WHERE c = NULL` — never true, so
the embed returned **zero** rows instead of all of them, the exact inverse of what None means. Both
passes are individually `try`-wrapped: a parse or generation failure degrades to plain `NULL`
substitution rather than failing the query.

So None means *the predicate is removed*, not *the predicate compares against NULL*. Taken to its
conclusion, `applyNoneParams("SELECT a FROM t WHERE COALESCE(:s,'')='' OR c = :s", {s: null})` yields
`SELECT a FROM t` with an empty params dict — every arm referenced `:s`, so the whole WHERE goes and
the query returns every row. That is the intended reading of "no filter".

Param names are validated as identifiers *before* any `RegExp` is built — guests control param
names on public pages, so a metacharacter name is a ReDoS/injection vector (pinned by
`lib/sql/__tests__/none-params-safety.test.ts`).

`enforceQueryLimit` adds `LIMIT 1000` when absent and clamps an explicit limit above 10000. It returns
the **original string untouched** when a limit is already in range — regenerating valid SQL through the
parser has caused real corruption (JSON `$`-path keys rewritten to `:param`). When it must regenerate,
`restoreParamPlaceholders` converts the dialect-native placeholder back to `:name` only outside string
and identifier literals. Parse failures and non-`SELECT` roots are no-ops, which is what makes it safe
to apply unconditionally in `runQueryStream`.
