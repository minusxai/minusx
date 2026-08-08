# `lib/templates` — the vocabulary a deployment ships

Templates are what the app (or the operator) hands every workspace to start from: chart
recipes today, story components next. They are **data on disk**, not documents and not code.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## The rule

```
frontend/templates/viz/*.viz     shipped in the image      origin: 'builtin'
$TEMPLATE_DIR/viz/*.viz          mounted per deployment    origin: 'deployment'   ← shadows by NAME
        │
        └─ loadTemplateRegistry (boot, once) ──▶ TemplateRegistry
                                                    ├─ setBuiltinVizRecipes()  (server)
                                                    └─ SSR preloadedState → configs.vizTemplates
                                                           └─ DataLoader → setBuiltinVizRecipes() (browser)
```

**They overlay, they do not replace.** An operator adding one template keeps the other ten.
This deliberately differs from the full-replace rule `supportedFileTypes` and `accessRules`
use, because shadow-by-name is what recipe resolution already does — one mental model, not
two. A workspace `.viz` file still beats both: `builtin templates < root file < … < nearest`.

**They are not files.** A template has no context file, no owner, no id and no place in the
file tree. Browsing them is `/templates` (`components/views/TemplatesView.tsx`); *overriding*
them is the file system's job. An earlier attempt projected them into the tree as virtual
files and had to fake ids, block writes in three places and exempt itself from resolution —
every invariant a folder implies was false. Do not reintroduce that.

## Loading is best-effort, and that is the design

This reads a directory an operator mounts, so **one bad file costs exactly that file**.
`loadTemplateRegistry` never throws: every rejection becomes a `skipped` entry with a reason,
logged at boot. The case that matters most — pinned by
`lib/templates/__tests__/template-loader.test.ts` — is that **an invalid deployment template
must not knock out the built-in it would have shadowed**, or a typo in one operator file
silently deletes a working recipe from every workspace.

Validation is the *same* gate an authored `.viz` file passes (`validateFileState`), not a
lookalike: the Ajv schema plus the dry-run materialization it already performs. An undeclared
`{{token}}` therefore fails at boot with the token named, rather than at render.

Codified rules, all tested: `.viz` and `.json` only (in that precedence order for a same-name
collision); dotfiles and unrelated extensions ignored **silently** — a README is not a broken
template; non-recursive; symlinks refused; names must match `TEMPLATE_NAME_PATTERN`, so a
template is always something a workspace file could be named to override; a directory listed
twice is read once; a missing or non-directory `TEMPLATE_DIR` warns and is skipped.

**Boot-time, so a deployment restarts to pick up new template files.** That is the trade:
templates change when a mounted directory changes, which is a deployment event, and paying an
`fs` walk per request to notice it sooner is the worse deal.

## Why the browser needs a registry at all

Built-in recipes are read on every recipe resolution — the save gate, the agent's per-turn
advertisement, the question page's selector tiles. They used to be a bundled TS module, so
they were simply *there*. On disk they are server-side, so `lib/viz/builtin-recipes.ts` is now
a **registry written exactly twice**: by the server's boot tasks, and by `DataLoader` once the
SSR-hydrated set reaches Redux. Reading it before either write yields `{}` — no built-in
recipes, which degrades to "workspace files and shipped `minusx/…` recipes still resolve"
rather than throwing.

Tests never run boot tasks, so `test/setup/vitest.setup.ts` installs the registry the same
way. Without it every recipe test sees an empty set and fails for a reason unrelated to what
it tests.

## Gotchas

- **`templates/` must be copied into the Docker image explicitly.** It holds data read at
  boot, never imported, so Next's output tracing cannot see it — `Dockerfile` copies it beside
  `lib/` and `scripts/`. A build that drops it boots with zero built-in recipes and no error.
- **`TEMPLATE_DIR` is resolved to an absolute path in `lib/config.ts`**, like `LOCAL_UPLOAD_PATH`.
  Unset is the off switch, not an empty-string path.
- **The shipped `minusx/…@1` recipes are NOT templates.** They are `build()` functions with
  real logic (funnel geometry, radar polygons, map projections) in `lib/viz/viz-templates.ts`,
  and cannot move to disk. The Templates page shows both tiers; only this one is overridable
  by a mounted directory.

## Key files

| Task | File |
|---|---|
| Change what counts as a template file, or how a bad one is handled | `lib/templates/template-loader.server.ts` |
| Change the directory list or precedence | `lib/templates/registry.server.ts` |
| Add a template kind (story components) | `lib/templates/types.ts` (`TemplateKind`) + the loader's kind walk |
| Change how the browser receives templates | `app/layout.tsx` → `components/app-shell/Providers.tsx` → `store/configsSlice.ts` → `components/app-shell/DataLoader.tsx` |
| Add or edit a shipped chart recipe | `frontend/templates/viz/*.viz` |
