# Build, test and docs infrastructure

How this repo is built, tested and documented: the npm script surface and the one-shot CLIs behind
it (`frontend/scripts/`), the Vitest project layout and shared test harness plus the two Playwright
suites and their deliberately opposite gates (`frontend/test/`), the offline agent benchmark
(`frontend/benchmarks/`), ambient type declarations (`frontend/types/`), CI (`.github/workflows/`),
and the separately-deployed documentation site (`docs/`).

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## What each module owns

**`frontend/scripts/`** — one-shot Node CLIs run through `tsx`, never imported by app runtime code.
Five families: **generators** that write committed artifacts (`generate-app-theme-css.ts`,
`generate-story-ui-classes.ts`, `generate-dashboard-chrome-css.ts`, `generate-theme-previews.ts`,
`generate-og-default.tsx`, `update-workspace-template.ts`); **browser matrices** that drive real
engines (`capture-matrix.ts` + `b2-surface-matrix.ts` + `story-width-matrix.ts`,
`headless-capture-fidelity.ts`); **DB mutators** that write to a live document DB
(`heal-stories.ts`, `migrate-conversations-to-v3.ts`); **read-only inspectors**
(`dump-llm-calls.ts`, `prompt-visualizer.ts`, `check-docs-consistency.ts`); and
`scripts/setup-cli/`, the only code here that ships inside the Docker image. It does **not** own the
behaviour it generates — every generator delegates to a `lib/` module and exists only to
serialize that module's output to disk.

**`frontend/test/`** — harness only; it contains no unit tests. Unit and integration tests live in
`__tests__/` directories next to the code they cover. This tree owns: the Vitest bootstrap
(`test/setup/`), the in-process route/DB harness (`test/harness/`), React Testing Library wrappers
(`test/helpers/`), the driver-independent flow vocabularies (`test/flows/`), and the two Playwright
suites (`test/e2e/`, `test/qa/`).

**`frontend/benchmarks/`** — offline agent-quality measurement (`runner.ts` is the generic engine,
`dataanalystbench.ts` the configured entry). Never runs in CI; it needs external datasets
(`DAB_BENCH_BASE_DIR`) and real LLM credentials. Distinct from `app/api/benchmark/import` (the
in-app route that ingests benchmark output) — the runner writes JSONL, the route reads it.

**The capture-matrix browser bundle has a real entry file.** `scripts/capture-matrix-bundle.ts`
imports the shipped modules and exposes them on `window` for the in-page drivers; esbuild bundles
that file into the `/bundle.js` the fixture pages load. It is a checked-in file rather than a
string assembled at build time specifically so the imports stay visible to `tsc`, ESLint and
`npm run knip` — a module reachable only through a template literal looks dead to every tool that
reads the repo. `scripts/b2-surface-drivers.tsx` (the dashboard-surface drivers) is reached this
way; the fixture pages deliberately carry zero stylesheets, so a tile that rasterizes empty proves
the surface depended on its environment.

The bundle carries its own YAML loader plugin. esbuild has no YAML support and the surface tree
transitively imports `orchestrator/prompts/story-guidance.yaml`, so `capture-matrix.ts` registers a
plugin that parses it — the esbuild-tier equivalent of `yaml-loader` (Turbopack),
`@rollup/plugin-yaml` (Vitest) and `scripts/register-yaml.mjs` (tsx). Without it the bundle does not
build at all. **`npm run capture-matrix` is not in CI**, so nothing catches it breaking except
running it.

`npm run knip` still reports `tailwindcss`, `@tailwindcss/oxide` and `yaml-loader` as unused
dependencies — all three are consumed through config rather than imports. Verify before deleting
anything it flags.

**`frontend/types/`** — ambient declaration files only (`next-auth.d.ts` augments
`User`/`Session`/`JWT` with `userId`/`role`/`home_folder`/`tokenVersion`). No values, no runtime.

**`.github/workflows/`** — CI and release. It owns the *required-check names*, not test content.

**`docs/`** — a standalone fumadocs (Next 16) app, statically exported and deployed independently.
It owns product documentation under `docs/content/`. Only `content/` is built into the site; any
other file in that directory is a plain repo file and is never published.

## npm scripts

Everything runs from `frontend/`. Names that mean what they say are omitted.

| Script | Notes |
|---|---|
| `validate` | The only types+lint gate. Runs `tsc --noEmit`, `eslint --cache --quiet`, and `scripts/check-docs-consistency.ts` concurrently (via `concurrently -g`). |
| `check-docs` | `check-docs-consistency.ts` alone. Three sweeps over **every** `CLAUDE.md` in the repo, not just the root: (1) each backticked path resolves, (2) no source comment references a missing `*.md`, (3) each nested doc is named in the root `CLAUDE.md`, unless it is a short pointer stub whose redirect target exists. Exits 1 if the root `CLAUDE.md` is absent. |
| `test` / `test:main` / `test:ui` / `test:orchestrator` | Vitest; all projects, or one. |
| `test:e2e` / `test:qa` | The two Playwright configs (see below). |
| `capture-matrix` | Chromium+WebKit+Firefox fixture matrix over the real serialization modules. No dev server. |
| `capture-fidelity` | Pixel-diffs the headless capture backend against the client serialize path. Sets `HEADLESS_CAPTURE=1` and a throwaway `NEXTAUTH_SECRET`. |
| `update-workspace-template` | Runs migrations over `lib/database/workspace-template.json` with placeholder values substituted, restores the `{{TEMPLATE_VAR}}` markers, writes back. Never touches a database — review with `git diff`. |
| `prompt-visualizer` | Emits a self-contained HTML token-budget view of the real prompt assembly. Needs `scripts/register-yaml.mjs`. |
| `build:setup-cli` | esbuild-bundles `scripts/setup-cli/*.ts` into a gitignored setup-cli/ directory for the Docker image. |
| `postinstall` | `copy-duckdb-wasm.mjs` (node_modules → `public/duckdb/`) then `patch-package --error-on-fail`. Two patches live in `frontend/patches/`: the pi-ai one carries real semantics (web search, remote image URLs, and the provider-reported cost that managed billing depends on), while `next+16.1.6.patch` edits Next's *compiled, minified* app-page runtime — its intent is not recoverable from the diff, so treat it as opaque and re-derive it against upstream on a Next bump rather than hand-merging. `--error-on-fail` is what stops either from being skipped silently. |
| `benchmark:dab` | Requires `DAB_BENCH_BASE_DIR`; throws immediately without it. |
| `knip` | Dead-export detection (`knip --no-config-hints`). `knip.json` declares `scripts/*.ts`, `scripts/*.mjs`, `benchmarks/dataanalystbench.ts`, `lib/__checks__/*.ts` and the Playwright `test/{e2e,qa}/*.setup.ts` files as entry points so they are not reported unused. `lib/__checks__/*.ts` is there because it holds compile-time-only guards with no runtime importer. |
| `generate-og:generic` | Regenerates the committed `public/ogs/generic.png`. |

`frontend/scripts/check-min-data-version.ts` is deliberately **not** an npm script and is wired to no
workflow in this repo. It refuses to ship a build that cannot read data still in service: raising
`MINIMUM_SUPPORTED_DATA_VERSION` is safe only once everything the deployment serves has been migrated
past it, and a workspace left behind is served by code that MISREADS its data — wrong content, not an
error. The comparison needs two numbers from two different builds (only the candidate knows its own
minimum, only the running deployment knows what it serves), which is why it is a script rather than
something the endpoint could answer alone. Run it with
`MIN_DATA_VERSION_URL=https://<host>/api/admin/min-data-version` and `CRON_SECRET` set. Exit `2`
("could not determine") is fatal on purpose: `withCronAuth` answers a wrong secret with
`200 {ok: true}`, so a missing `min` in the response must never read the same as a pass.

Most of these (`generate-app-theme-css`, `generate-dashboard-chrome-css`,
`generate-theme-previews`, `generate-og:generic`, `update-workspace-template`, `capture-fidelity`,
`prompt-visualizer`, `benchmark:dab`, and the two operational CLIs `heal-stories` /
`migrate-conversations-to-v3`) run with `tsx --conditions react-server` because they import
`server-only`-guarded modules; `generate-story-ui-classes`, `capture-matrix` and `dump-llm-calls`
do not need it. `setup-cli` can't
use that trick — it runs under plain `node` inside the image — so `build:setup-cli` esbuild-aliases
`server-only` to the empty `scripts/setup-cli/server-only-empty.js` instead. Two escapes from the
same guard, for two different execution contexts.

`orchestrator/prompts/prompts.yaml` is imported natively, which costs a YAML loader per runtime:
`yaml-loader` for the Next build, `@rollup/plugin-yaml` for Vitest (`vitest.config.ts`), and
`scripts/register-yaml.mjs` (a `node:module` `registerHooks` hook, loaded via `node --import`) for
`prompt-visualizer`. All three must stay in sync or the affected runtime dies with
`ERR_UNKNOWN_FILE_EXTENSION ".yaml"`.

## Vitest layout

`frontend/vitest.config.ts` defines three projects sharing one `@` → `frontend/` alias and a 45s
test/hook timeout:

```
node          environment: node    **/__tests__/**/*.test.{ts,tsx}
                                   minus *.ui.test.*, minus orchestrator/**, minus agents/**
                                   setup: test/setup/vitest.setup.ts
ui            environment: jsdom   **/__tests__/**/*.ui.test.{ts,tsx}
                                   setup: vitest.setup.ts + vitest.setup.ui.ts
orchestrator  environment: node    orchestrator/**/__tests__/**  +  agents/**/__tests__/**
                                   setup: vitest.setup.orchestrator.ts (which imports vitest.setup.ts)
```

The `node` project's exclusion of `orchestrator/**` and `agents/**` is what keeps a file from
running twice. Anything else matching `__tests__/**/*.test.ts` lands in `node` — including
`scripts/__tests__/dump-llm-calls.test.ts`. There is no separate scripts project.

`test/setup/vitest.setup.ts` runs for **all three** projects and is where global isolation is
enforced: `@/lib/database/db-config` is mocked so `getDbType()` returns `'pglite'` with every path
`undefined` (in-memory, no persistence directory can be reached); `server-only`, `next-auth` and
`@/auth` are stubbed; `@/lib/auth/auth-helpers` returns a fixed admin `EffectiveUser`; the module
registry is pre-populated with a real `DBModule` and throwing stubs for auth/store/cache; and
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are set to a sentinel that passes "key exists" checks but
guarantees a 401 on a real call.

`@/lib/analytics/file-analytics.server` is mocked with an explicit export list. That list must
track the real module: add an export there without adding a stub here and every test that
transitively imports it fails with a Vitest mock error.

## Test database harness

`test/harness/test-db.ts` gives each suite an isolated Postgres schema inside one shared PGLite
adapter:

```
setupTestDb('…/foo.db')
  → schemaFromPath()  = basename minus extension, non-alphanumerics → '_'   ("foo")
  → beforeAll:  CREATE SCHEMA IF NOT EXISTS foo; run POSTGRES_SCHEMA DDL once per (adapter × schema)
  → beforeEach: ONE adapter.exec() — SET search_path + DELETE all + INSERT the seed template
  → afterAll:   deliberate no-op (keeps the adapter warm for later suites in the file)
```

Two invariants follow. **The schema name is derived from the basename only** — two suites whose
`dbPath` shares a basename share a schema and therefore share data; `getTestDbPath('<unique-name>')`
exists so callers pick a distinct one. **The per-test reset is a single `exec` with no JS yields**,
so an async listener left running by a previous test cannot interleave and produce duplicate-key
errors; splitting that call back into separate statements reintroduces the flake it was written to
kill.

The harness itself is split across two trees, which is not where a reader would look:
`setupTestDb` comes from `@/test/harness/test-db`, but `getTestDbPath`/`setupTestStore` come from
`@/store/__tests__/test-utils`, which `test-db.ts` imports.

`test/harness/mock-fetch.ts` is the second half of the node-layer stack: it replaces `global.fetch`
with a matcher that routes matching URLs into real Next.js route handlers (constructing a
`NextRequest` from the *pattern*, not the actual URL) and **throws on any unmatched call**. That
throw is the contract — an unmocked network call is a loud failure, never a silent pass.

## Playwright: two suites, deliberately opposite gates

`playwright.config.ts` (`test/e2e/`) and `playwright.qa.config.ts` (`test/qa/`) use the same tooling
to prove different things:

```
E2E   next build with NEXT_PUBLIC_E2E=true   →  E2E_MODE permanently on
      /api/test/faux live · window.__MX_STORE__ always exposed · SVG charts
      specs may script the LLM: setFauxLLM / resetFauxLLM  (test/flows/e2e-faux.ts)
      port 3100 · distDir .next-e2e · PGLITE_DATA_DIR data/pglite-e2e
      workers: 1, fullyParallel: false   (tutorial reset is workspace-wide)

QA    next build with NEXT_PUBLIC_E2E deliberately UNSET
      faux channel 404s · store exposed only after ?e2e=<E2E_RUNTIME_SECRET> (cookie-persisted)
      REAL LLM → assertions must be structural/deterministic, never on generated text
      port 3101 · distDir .next-qa · PGLITE_DATA_DIR data/pglite-qa
      workers: QA_PARALLELISM || 2, fullyParallel: true
      setup chain: auth.setup → reset.setup (reset tutorial + warm sample data via waitForTutorialData) → qa specs
```

That asymmetry explains the rest: there is no faux-assertion helper on the QA side, `qa.yml` must
supply a real provider credential, and `test/qa/runtime-gate.spec.ts` exists purely to prove the
runtime opt-in works in all three directions (absent → not exposed, correct secret → exposed and
persists across navigation, wrong secret → not exposed).

The QA config never runs `next dev`. Locally it does a full `npm run build && npm run start`;
`QA_SKIP_BUILD=1` (CI) skips straight to `next start` on a restored build. The dev server compiles
routes on demand and races cold builds under parallel workers, producing `page.goto` timeouts.

**QA's tutorial-mode discipline** lives in `test/qa/flows.ts`. `QA_MODE = 'tutorial'`; `modeUrl()`
appends `mode=tutorial`; `e2eUrl()` appends that plus `e2e=<secret>`; every `/api/files` discovery
call carries `mode=tutorial` explicitly. The system default is `org`, so tutorial is opt-in on every
single request. Mutating flows add two guards: `assertTutorialMode(page)` polls Redux for
`auth.user.mode === 'tutorial'` and **fails the test** if it never holds, and the post-save
assertions (`assertQuestionSaved`, `assertDashboardSavedWithQuestion`) hard-require
`path.startsWith('/tutorial')`. `resetTutorial()` by contrast is best-effort — a non-admin QA
account gets a `console.warn` and the read-only flows continue.

**QA specs import `test` from `test/qa/flows.ts`, not from `@playwright/test`.** That re-export is
`base.extend` with one always-on fixture: a console guard (`test/qa/console-guard.ts`) that collects
`console.error` and uncaught `pageerror` events and fails the flow on anything not explicitly
allowlisted. It exists because the QA assertions are all Redux + DOM, so a page that throws while
still rendering the elements a flow clicks passed silently — a React hydration mismatch on the
tutorial home page (`Minified React error #418`) lived there unnoticed, visible only with devtools
open. Importing `test` from `@playwright/test` in a new spec silently opts out of the guard.

Two things keep it from becoming noise. It asserts **only when the test would otherwise have
passed** (`testInfo.status === testInfo.expectedStatus`), so a flow that fails its own assertion
reports that, not a console line logged on the way. And the allowlist requires a stated reason per
entry — it currently tolerates the hydration mismatch above (pre-existing on main:
`components/ui/Link.tsx` calls `preserveParams()`, which no-ops on the server and appends
`?mode=`/`?as_user=`/`?view=` on the client, so the first client render disagrees with the SSR HTML),
navigation-cancelled fetches, and devtools advisories. Its hydration entry delegates to the app's own
`isHydrationError` (`lib/utils/error-utils.ts`), so tightening the classifier tightens the gate.

Both suites locate controls by `aria-label` via `getByLabel` — 55 of the ~67 locators across
`test/e2e`, `test/qa` and `test/flows`. A control without one is a missing `aria-label` on the
component, not a reason to use a different query. The three standing exceptions are structural, not
loopholes: `getByPlaceholder` in the two `auth.setup.ts` files (the login form), and `.locator()`
over the `data-*` DOM contract (`[data-file-id]`, `svg[data-mx-story-svg] foreignObject`) in
`test/e2e/story-lifecycle.spec.ts` and `test/qa/dashboard-theme.spec.ts`, where the target is an
iframe surface rather than a control.

## CI

| Workflow | Trigger | Gates |
|---|---|---|
| `test.yml` | push main, PR | `validate` job (tsc + eslint + check-docs) and a 6-way Vitest shard matrix. |
| `e2e.yml` | push main, PR | Builds once with `NEXT_PUBLIC_E2E=true` into `.next-e2e`, then runs Playwright with `E2E_SKIP_BUILD=1`. |
| `qa.yml` | PR only | `qa-build` (Turbopack → `.next-qa`, uploaded as a tar) → `qa-flows` 3-shard matrix → `qa` aggregator. |
| `docker-build-check.yml` | PR, path-filtered | Builds the prod image with `push: false`. Filter covers Dockerfile, patches, lockfile, `next.config.ts`, `copy-duckdb-wasm.mjs`. |
| `publish.yml` | push main, `v*` tags, manual | main → `minusx-frontend-canary:latest`; tag → `minusx-frontend` semver+latest. Then dispatches the staging-deploy workflow in the private minusxai/deploys repo. |
| `docs-deploy.yml` | push main touching `docs/**` | Dispatches the docs-deploy workflow in the private minusxai/deploys repo. |
| `claude.yml` | `@claude` mentions | — |

Non-obvious CI facts:

- **The aggregator job `name:` strings are the branch-protection contract**, not the shard names:
  `Frontend Tests (Chat API, E2E, MinusX Agent)` (`test.yml`) and `QA Flows (prod build)`
  (`qa.yml`). Shard counts can change freely; renaming those two breaks required checks.
- Both the E2E and QA build jobs set `NEXT_SKIP_TYPECHECK: 'true'`. **A type error does not fail
  them** — `validate` is the sole types gate. (`next.config.ts` maps that env var to
  `typescript.ignoreBuildErrors`, and points the in-build check at `tsconfig.build.json`, which
  excludes tests.)
- Both build jobs must set `NEXTAUTH_SECRET` at *build* time: "Collecting page data" executes the
  auth route modules and `lib/config.ts` throws when it is unset.
- `qa.yml` tars `.next-qa` before upload because Turbopack emits chunk filenames containing a colon,
  which `upload-artifact@v4` rejects as an invalid path. The standalone and cache subdirectories are
  excluded from the tar.
- `qa.yml` sets `USE_BASE64_UPLOADS: 'true'` — with no S3 in CI, chart images would become
  `http://localhost` URLs that the Claude API rejects ("Only HTTPS URLs are supported").
- Model config is DB-only in the app, so `test/qa/auth.setup.ts` reads the runner-side
  `AWS_BEARER_TOKEN_BEDROCK` / `ANTHROPIC_API_KEY` / `ANALYST_AGENT_MODEL_CONFIG` env and seeds them
  into the workspace via `POST /api/configs` — the same path an admin uses. Fork PRs get no secrets,
  so the real-LLM describe skips rather than failing.
- No Turbopack build cache is restored anywhere: measured warm ≈ cold, so caching was pure overhead.
  `node_modules` and the Playwright browser binaries *are* cached, on a key shared by all three
  workflows.
- **Node 22 everywhere the app runs, stated in three places that must agree.** `actions/setup-node`
  pins `'22'` in `test.yml`, `e2e.yml` and both `qa.yml` jobs; `frontend/Dockerfile` builds and runs on
  `node:22-slim`; `frontend/package.json` declares `engines.node: ">=22.19.0"`. There is no `.nvmrc`
  and no `engine-strict`, so the `engines` field warns rather than blocks — the real gates are the
  workflow pin and the image. Bumping one without the others is the failure this triple exists to make
  visible: CI green on a runtime the image does not ship. `docs/Dockerfile` is deliberately still
  `node:20` — the docs site is a separate app with its own `package.json` and shares nothing with the
  frontend build.

## The docs site

A second Next app with its own `package.json`, `node_modules`, and `tsconfig.json`. `output: 'export'`
(`docs/next.config.mjs`) makes it a fully static bundle; `docs/app/api/search/route.ts` is
`force-static` and pre-renders the fumadocs search index rather than serving it.

```
content/docs/**.mdx  ─┐
content/guides/**.mdx ┴→ source.config.ts (defineDocs) → .source/server → lib/source.ts (loader)
                          → docsSource.pageTree → app/docs/layout.tsx (DocsLayout sidebar)
                          → app/docs/[[...slug]]/page.tsx  (and the parallel /guides tree)
```

Sidebar structure is entirely `meta.json`: `title`, `pages` (order **and** inclusion), `defaultOpen`.
The root `content/docs/meta.json` carries `root: true` and uses `"---Label---"` entries as section
separators. Two tabs (Docs, Guides) are two separate roots, switched by the client component
`lib/tabs.tsx` rendered as the sidebar banner.

**The one cross-boundary import.** `docs/components/compatibility-tables.tsx` does
`import compatibility from '../../frontend/compatibility.json'` so the supported-databases and
supported-models tables cannot drift from what the app actually supports. Three files conspire to
make that work: the import itself, `docs/next.config.mjs` widening `turbopack.root` to the repo
parent so imports may cross above `docs/`, and `docs/Dockerfile` copying the file to
`/frontend/compatibility.json` to preserve the relative path. Consequence: **the docs image must be
built from the repository root**, not from `docs/`.

## Interactions with other areas

- **`lib/` and `components/` → the test harness.** Over 200 test files import `@/test/harness/test-db`
  (integration) or `@/test/helpers/render-with-providers` (jsdom). `render-file-page.tsx` reproduces
  `FileLayout`'s position-relative container plus `ViewStackOverlay` without importing `FileLayout`
  (which transitively pulls ESM-only packages the runner can't transform). `dashboard-surface.ts`
  binds Testing Library queries to the dashboard iframe's document, because `screen` is bound to the
  top document and cannot see inside the surface — and mirrors the production readiness scan in
  `lib/screenshot/readiness.ts`.
- **Screenshot / story / dashboard-surface modules → `scripts/`.** `capture-matrix.ts` esbuild-bundles
  and drives the *real* `lib/screenshot/serialize-element.ts`, `lib/story-surface/serialize.ts` and
  `lib/data/story/banned-css.ts`; `b2-surface-matrix.ts` drives the shipped `DashboardSurface` and
  `WindowedTile`; `headless-capture-fidelity.ts` imports `lib/headless-capture/index.server.ts`.
  Renaming an export in those modules breaks `npm run capture-matrix`, not a unit test — and nothing
  in the Vitest suite will tell you.
- **Generated-artifact loop.** `generate-app-theme-css` → `app/theme-tokens.css`,
  `generate-story-ui-classes` → `lib/story-ui/recipe-classes.ts`, `generate-dashboard-chrome-css` →
  `lib/dashboard-surface/chrome-css.gen.ts`. Each has a freshness test in the owning module's
  `__tests__/` that fails when the committed output no longer matches its sources, so the generator
  is not optional after touching `components/kit/` or the theme definitions.
- **Database area → `scripts/update-workspace-template.ts`.** It reads
  `lib/database/workspace-template.json`, applies `lib/database/migrations`, and writes back. Adding
  a migration without running it leaves the seed template behind `LATEST_DATA_VERSION`.
- **Orchestrator/agents → `benchmarks/`.** `runner.ts` instantiates `Orchestrator` directly with a
  `registrables` list, so it depends on the same registry contract as production chat but bypasses
  the chat routes entirely. `benchmarks/dataanalystbench.ts` wires the `agents/benchmark-analyst/*`
  classes — which is why those keep `Base*` variants free of `server-only`.
- **`install.sh` → `frontend/compatibility.json` and `scripts/setup-cli/`.** The installer curls
  `compatibility.json` from raw.githubusercontent for its interview and runs
  `docker run --rm -i <image> node setup-cli/<entry>.js` for validation, passing JSON on stdin
  (never argv — argv leaks secrets to `ps`) and reading a JSON object from stdout. Exit codes are
  the API: `0` ok, `1` validation failed, `2` malformed input.
- **ESLint → this area.** `eslint.config.mjs` grants `scripts/**`, `test/setup/**` and the two
  Playwright configs an exemption from the `process.env` ban; turns off
  `react-hooks/rules-of-hooks` for `test/e2e/**` (the Playwright fixture callback is named `use`);
  and disables the import-discipline and `no-restricted-syntax` rules across `test/**` and all
  `__tests__/`.

## Gotchas

- **`vitest.setup.ui.ts` still mocks ECharts.** `vi.mock('@/lib/chart/echarts-init', …)` names a
  module that does not exist and `vi.mock('echarts', …)` names a package that is not a dependency.
  Both are inert. The `HTMLCanvasElement.prototype.getContext` stub below them is attributed to
  ECharts but is jsdom hygiene independent of it.
- **`TestDbOptions.withTutorialFiles` is declared and never read.** `setupTestDb` destructures only
  `customInit` and `withTestConnection`. Passing it does nothing.
- **`mirrorAppStyles` is mocked to a no-op in jsdom** for a reason worth knowing before you remove
  it: the real implementation re-serializes every accumulated `<style>` rule on each render, which
  goes O(n²) across a test file's shared document (it once turned a 9-test file into ~13 minutes).
- **`test/qa/*` runs against production URLs when `QA_BASE_URL` is set.** The only thing standing
  between a QA run and production files is `mode=tutorial` on every request plus the two mutation
  guards. Adding a flow that forgets `modeUrl`/`e2eUrl` silently targets `org`.
- **The e2e Playwright config defaults to `npm run dev`.** CI overrides it with `E2E_SKIP_BUILD=1`.
  Locally, first-run route compilation dominates the wall clock; `reuseExistingServer` is on
  outside CI, so a stale server on 3100 will be reused as-is.
- **`heal-stories` and `migrate-conversations-to-v3` require the dev server to be stopped** — PGLite
  is a single-process file database. The conversation migration has an in-process alternative
  (`POST /api/admin/migrate-conversations-v3`) that works while the server runs.
- **`installation/self-hosted.mdx` is not in `installation/meta.json`'s `pages` array.** It builds
  and is reachable by URL, but never appears in the sidebar. No `meta.json` in the repo uses a
  rest (`"..."`) entry, so omission from `pages` always means omission from the tree.
- **`check-docs` is part of `validate`.** It exits non-zero if the repo-root `CLAUDE.md` is missing,
  so `npm run validate` fails until that file exists.
- **`check-docs`'s path sweep falls back to matching by BASENAME.** Before failing, it looks for the
  path's last segment anywhere under `frontend/` and then anywhere in the repo. So a pointer with the
  right filename and the *wrong directory* passes the gate — `lib/ui/story-theme-options.ts` resolves
  even though the file is at `lib/branding/`. The gate catches deleted files, not moved ones; a
  green `check-docs` is not proof that a doc's paths are correct.

## Key files

| Task | File |
|---|---|
| Add or change a Vitest project or alias | `frontend/vitest.config.ts` |
| Add a global test mock (all projects) | `frontend/test/setup/vitest.setup.ts` |
| Add a jsdom-only mock | `frontend/test/setup/vitest.setup.ui.ts` |
| Isolated DB for a test suite | `frontend/test/harness/test-db.ts` (+ `getTestDbPath` from `frontend/store/__tests__/test-utils.ts`) |
| Route an in-process API call in a test | `frontend/test/harness/mock-fetch.ts` |
| Render a component with providers | `frontend/test/helpers/render-with-providers.tsx` |
| Assert on Redux without polling | `frontend/test/helpers/redux-wait.ts` |
| Add a faux-LLM browser E2E spec | `frontend/test/e2e/` (+ `frontend/test/flows/e2e-faux.ts`) |
| Add a real-LLM QA flow | `frontend/test/qa/flows.ts` (import `test` from here, not `@playwright/test`) |
| Allow a known-benign console error in QA | `frontend/test/qa/console-guard.ts` |
| Change E2E server env / ports | `frontend/playwright.config.ts` |
| Change QA server env / workers | `frontend/playwright.qa.config.ts` |
| Add/rename a CI job or required check | `.github/workflows/test.yml`, `.github/workflows/qa.yml` |
| Cross-engine capture regression | `frontend/scripts/capture-matrix.ts` |
| Refresh the seed template after a migration | `frontend/scripts/update-workspace-template.ts` |
| Inspect real prompt token budgets | `frontend/scripts/prompt-visualizer.ts` |
| Change what `install.sh` validates | `frontend/scripts/setup-cli/` |
| Run the agent benchmark | `frontend/benchmarks/dataanalystbench.ts` |
| Add a docs page / reorder the sidebar | `docs/content/docs/**/meta.json` |
| Docs ↔ app shared support matrix | `frontend/compatibility.json` → `docs/components/compatibility-tables.tsx` |

**Two root compose files, two different stacks — and the one named `prod` tracks the *less* stable image.** `docker-compose.yml` pulls `ghcr.io/minusxai/minusx-frontend:latest` (the semver-tagged release image) and runs fully embedded: `DB_TYPE=pglite`, `PGLITE_DATA_DIR=/app/data/pglite` on a named `pglite_data` volume, no external database. `docker-compose.prod.yml` pulls `ghcr.io/minusxai/minusx-frontend-canary:latest` — the image `publish.yml` builds from every push to main — and sets `DB_TYPE=postgres`, which requires `DATABASE_URL` in `frontend/.env` before the container will start. Both read `frontend/.env` via `env_file` and share `BASE_DUCKDB_DATA_PATH=/app` plus `ANALYTICS_DB_DIR=/app/data/analytics`. Reaching for the `.prod` file because of its name gets the canary build; the plain file is the stable one.

---
