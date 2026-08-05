# Render surfaces — mounting a self-contained document

The same-origin iframe surface a stored document mounts into: `lib/story-surface` (mount, size,
serialize), `lib/dashboard-surface` (the dashboard's closed style universe) and `lib/html` (iframe
document plumbing). These three share consumers.

A **surface** is the `<svg><foreignObject><div data-mx-story-root>` structure inside that iframe.
Stories and dashboards both mount one; it is *not* a shadow root (shadow DOM was evaluated and
rejected — see the design decisions below), and it is what every downstream tier targets: embeds,
WYSIWYG editing and capture all address `surface.root` or the `<svg>` around it.

The three tiers, in order: authoring → **mounting (here)** → capture. The tree that gets mounted is
`frontend/lib/story-ui/CLAUDE.md`; turning a mounted surface into an image is
`frontend/lib/screenshot/CLAUDE.md`. The clone-fixup primitives live here and are called from there,
so the gotchas in this file about serialization apply to both.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## `lib/story-surface` — mount, size, serialize

`index.ts` hides the DOM-vs-SVG difference behind one interface so `AgentHtml` stays a thin
composition. Two implementations exist; **`'svg'` is the only one app code ever mounts** —
`AgentHtml`'s `surface` prop defaults to `'svg'` and no caller passes it, and `DashboardSurface`
passes `'svg'` literally. The `'dom'` branch survives as the abstraction's second implementation and
is exercised only by tests.

```
mountStorySurface(doc,'svg',w) → <svg data-mx-story-svg>
                                   └ <foreignObject>
                                       └ <div data-mx-story-root xmlns=XHTML>   ← surface.root
autoSizeStorySurface({surface, iframe, doc, fluid, fixedHeight?})
   sync(): stamp --mx-vh → [fluid] applyWidth(measured) → reflow
           → measureHeight() → applyHeight() → iframe.style.height
   observes: RO(surface.root), RO(iframe), window 'resize' → disposer
```

Non-obvious invariants, all pinned by `__tests__/story-surface.ui.test.ts`:

- An `<svg>` does **not** auto-size to its `foreignObject` content — it defaults to 150px. Height and
  (for fluid callers) width must be pushed in explicitly, on **both** the svg and the foreignObject,
  since each clips its content.
- The root must carry the XHTML namespace or the browser parses it as an unknown SVG element and
  renders nothing.
- Heights round **up** (a short svg clips the last text line); widths round **down** (a surface wider
  than its container is exactly the clipping failure this prevents). Both writes are change-guarded,
  because the caller drives them from a `ResizeObserver` and a redundant write re-triggers it.
- `sync()` order is load-bearing: width → reflow → measure → applyHeight. Reading `scrollHeight`
  flushes layout, so the reflow between the two is synchronous.
- The fluid measure is `(doc.body.clientWidth || iframe.clientWidth) − horizontalPadding(doc.body)`.
  `clientWidth` is the *padding* box, but the surface's containing block is the body's *content* box,
  so authored `body{padding}` (legacy stories inject their own CSS verbatim) must come off it or the
  surface overhangs and `overflow-x:hidden` clips it silently. A measured `0` is never applied — a
  detached or `display:none` container measures 0 and would collapse the surface to min-content.
- `RO(iframe)` — a *top-document* target — is the only thing that fires on a pane-width change; the
  inner document's observer is not reliably delivered across realms. The observer pair is created
  when **either** axis still needs resync (`fluid || fixedHeight === undefined`), never on height
  alone, or a fixed-height fluid caller would stay pinned to its mount width forever.
- The iframe is content-sized, so `vh` inside a story is useless; the surface stamps the host
  window's `innerHeight` as `--mx-vh` **on the root** (inside the serialized subtree) so captures
  keep it. `STORY_FLUID_SHIM_CSS` caps chart embeds/media to the container and must likewise be
  injected *into the root*, not `<head>`.
- `STORY_CANVAS_WIDTH = 1280` is the logical canvas — the fallback before a fluid story can measure
  its parent, the width `components/views/story/ScaledStoryFrame.tsx` re-exports as `STORY_W`, and
  the headless capture default.

`serialize.ts` turns the live `<svg>` into a standalone string. An `<img>`-rendered SVG has no parent
document and no network, so everything it would otherwise resolve externally is fixed up **on the
clone only** (the live DOM is never mutated):

- head styles cloned in (`collectSurfaceCss` — the story's own `<style>` blocks already live inside
  the root and travel with it);
- remote `url()` refs in every in-clone `<style>` inlined as `data:` URIs (`inlineFontUrls`, cached
  forever — fonts are immutable), and `<img src>` inlined the same way. A face that fails to inline
  keeps its original URL, which the `<img>`-rendered SVG cannot fetch, so the text renders in a
  **fallback family** — and substituting a family changes glyph widths, so spacing and line
  **wrapping** shift with it. That is one degradation presenting as three, which is why
  `takeFailedFontUrls()` exists: it drains the URLs that failed since the last call (and
  `inlineFontUrls` warns), so a degraded capture is observable instead of being read as three
  unrelated rendering bugs. Same contract as `reviewFile`'s `renderPending` / `reviewNote`;
- scroll offsets baked as transforms (`applyScrollOffsets` — `scrollLeft` is a property, so
  `XMLSerializer` drops it) and form state stamped as attributes (`stampFormValues`);
- `applyInheritedTypography` — the standalone document has no `<html>`/`<body>`, so Tailwind
  preflight's html-level environment matches nothing; without baking the live root's computed
  `color`/`font-family`/`font-size`/`line-height`/`letter-spacing`/`text-size-adjust`/`tab-size` onto
  the clone root, text falls back to UA serif at `line-height: normal` and **re-wraps**;
- the current color-mode class on the clone root, because there is no `<html>` for `.dark`-scoped
  rules to match;
- an explicit intrinsic `width`/`height` on the clone, because engines disagree about the intrinsic
  size of an `<img>`-rendered SVG that declares none.

`awaitFontsReady(doc)` (bounded, 3 s default, never throws) runs before the clone so serialization
reflects loaded-font layout. `svgToImage` rasterizes through a **percent-encoded `data:` URL, never a
Blob URL** — Blob-URL SVG taints the canvas in Chromium and WebKit — and awaits `document.fonts.ready`
plus full `img.decode()` before resolving, which is the main defense against blank captures.

`findStorySvg(element)` looks for `svg[data-mx-story-svg]` inside the element's iframe (or in the
element itself when it *is* the iframe). Because `DashboardSurface` mounts the same surface,
dashboards are picked up by this path with no dashboard-specific code.

## `lib/dashboard-surface` — the dashboard's closed style universe

Dashboards have **no authored classes**: every class inside the surface comes from our own
components, a closed set. So one static stylesheet covers every dashboard —
`chrome-css.gen.ts`, **generated** by `scripts/generate-dashboard-chrome-css.ts`
(`npm run generate-dashboard-chrome-css`) from react-grid-layout css + react-day-picker css +
compiled chrome utilities + the shadcn token layer (both modes, `--chart-1..5`) + the design-theme
`[data-theme]` blocks. `__tests__/chrome-css.test.ts` recomputes `DASHBOARD_CHROME_CSS_VERSION` from
current sources and fails when the artifact is stale — otherwise the iframe would silently lose
styles — and asserts the sheet contains no non-`data:` `url()` (an external ref would 404 or taint a
capture). Note the chrome compile deliberately does **not** run the story pipeline's `sticky` ban:
sticky table headers are our code, not authored CSS, and the test asserts `.sticky` is present.

`surface-width.tsx` is a bare React context. react-grid-layout's `WidthProvider` measures through
`resize-observer-polyfill`, whose refresh triggers are top-document events that never fire inside the
iframe realm — it measures once and goes deaf. The surface already tracks width authoritatively, so
`DashboardView` consumes `useSurfaceWidth()` instead of re-deriving it. The context is shared, not
dashboard-only: `AgentHtml` provides it around the jsx story body the same way (iframe-element
ResizeObserver, 60 ms trailing debounce), where the story `<Grid>`'s edit-mode react-grid-layout
consumes it.

## `lib/html` — iframe document plumbing

- `sanitize-agent-html.ts` — DOMPurify for legacy HTML stories. Wraps input in
  `<div data-mx-story-root>` *before* sanitizing, because the parser would otherwise hoist a leading
  `<style>` into `<head>` and DOMPurify only returns the body. `<style>` is explicitly allowed (the
  iframe isolates it); `data-*` survives, so embed placeholders reach the portal step untouched.
- `agent-iframe-csp.ts` — `default-src 'none'` backstop. Nothing executes or fetches in the iframe
  realm (the nested React root runs in the top realm and fetches there), so only styles, fonts,
  images and media are allowed. `font-src 'self'` is required: next/font serves woff2 from
  same-origin `/_next/static/media/*`.
- `mirror-app-styles.ts` — copies the app residue the surface document still needs into the
  `style[data-mx-app-styles]` tag: static base guards (`.mx-chart-fill`, the `min-width: 0`
  grid/flex blow-out guard, the marquee utility) plus the top document's `@font-face` rules,
  absolutized against each sheet's own href. That is all — no Chakra/emotion CSSOM. The UI test setup
  mocks this module wholesale to a no-op (jsdom's `cssRules` is a slow JS reimplementation and goes
  quadratic across a test file).
- `css-urls.ts` — `absolutizeCssUrls`, deliberately dependency-free because it is shared by the
  mocked mirror **and** by the capture serializers; importing it from the mirror silently broke
  capture CSS collection in tests.
- `resolve-story-fonts.ts` — captures scan `@font-face`, not `@import`, so imported web-font
  stylesheets are fetched and their faces injected. Cached by URL set; an all-failed result is
  deliberately not cached so a later capture retries.
- `serialize-story.ts` — the save-side inverse of render for legacy stories: scope to
  `[data-mx-story-root]`, collapse nested wrappers, strip injected `data-mx-*` style tags and the
  embed-root host, strip leaked Ark `[data-scope]` runtime DOM, restore embeds to their authored
  empty placeholders from the `data-mx-osz` snapshot, drop `contenteditable`, and re-insert the
  hoisted `@import` font lines. Works on a clone in the root's **own** document.
- `heal-story.server.ts` — jsdom-only backfill (`lib/data/heal-stories.server.ts`) that runs the same
  serializer over a stored string; short-circuits unless the string carries `data-mx-story-root` or
  `data-scope`, so clean stories are never rewritten for incidental reformatting.

## Interactions with other areas

**Story render path.** `components/views/story/StoryView.tsx` → `components/views/shared/AgentHtml.tsx`
builds the iframe document, mounts the surface, injects styles, provides the measured surface width
(`SurfaceWidthContext` — the story grid's edit mode consumes it), and portals the body in.
`format:'jsx'` bodies go through `components/views/shared/StoryJsxBody.tsx`, which calls `parseJsx` +
`renderStoryNodes` with `STORY_UI_COMPONENTS` plus the live embeds from
`components/views/shared/StoryEmbeds.tsx`. **Contract:** the interpreter runs in the *parent* React
tree and its output is portaled into `surface.root`; iframe events do not bubble to the parent
document, so anything interactive must render from a root inside the iframe.

**Dashboard render path.** `components/containers/DashboardContainerV2.tsx` puts `data-file-id` on a
wrapper around `components/views/shared/DashboardSurface.tsx`, which reuses `mountStorySurface` /
`autoSizeStorySurface` / `StoryEmbedProviders` and injects only `DASHBOARD_CHROME_CSS` + the app-style
mirror. **Contract:** styles go **inside `surface.root`**, never `<head>` — the serialized `<svg>`
must be self-contained by construction. (`collectSurfaceCss` head-cloning exists for stories, whose
authored `<style>` blocks already live in the root.) DashboardSurface must also stamp
`data-mx-busy` on the root at build and clear it after the nested root's first commit
(`ClearBusyStamp`), or `lib/screenshot`'s readiness gate settles on an empty surface.

**Save path (`lib/data/story`).** `file-markup.ts` validates incoming markup with
`validateJsxSource` against `JSX_STORY_COMPONENT_NAMES` + `STORY_HTML_TAGS`; `content-jsx.ts` does the
`content ⇄ jsx` conversion and is the only caller of `sanitizeLooseJsx`; `jsx-edit.ts` applies WYSIWYG
DOM edits back onto the AST by `data-mx-ast` path and re-runs `validateJsx` on the result.
`content-jsx.ts` also rejects, at save time, a body that parses but contains no element nodes
(`jsxBodyError`) — a text-only body would otherwise render verbatim as a wall of markup.

## Gotchas

- **A Blob URL for the rasterizing `<img>` taints the canvas** in Chromium and WebKit. `svgToImage`
  uses a percent-encoded `data:` URL; never "optimize" this.
- **Styles injected into `<head>` are lost by the SVG capture path.** Anything the surface needs must
  live inside `surface.root` — which is also why `serialize-story.ts` strips the whole `data-mx-*`
  style family on save (otherwise derived CSS compounds into `content.story` on every round-trip).
- **DOM *state* is not markup.** Scroll offsets, `input.value`, `checked`, `<option>.selected` and
  `<canvas>` pixels all vanish through `XMLSerializer` and are stamped in explicitly. All these
  fixups walk live and clone trees **in lockstep** and must run before any structural removal — that
  ordering is a contract `lib/screenshot/serialize-element.ts` also depends on.
- **Both generated artifacts are CI-gated for freshness**, not for correctness: change a kit/chrome
  source without regenerating and `lib/dashboard-surface/__tests__/chrome-css.test.ts` /
  `lib/story-ui/__tests__/recipe-classes.test.ts` fail — a missing regeneration surfaces as a failing
  test, never as a silently unstyled iframe. The extractors tokenize **raw source text**, so even a
  comment edit to a file in `components/kit/`, `EMBED_CHROME_FILES` or `DASHBOARD_CHROME_FILES`
  (`scripts/generate-story-ui-classes.ts`, `scripts/generate-dashboard-chrome-css.ts`) changes the
  candidate set and trips both gates. Regenerate after touching those files, whatever you changed.
- **`applyWidth` rounds down, `applyHeight` rounds up.** They are not symmetric, on purpose.
- **`'dom'` surface is unreachable from app code.** `AgentHtml` defaults to `'svg'`, nothing passes
  otherwise, so the DOM-surface branches (and `lib/og/capture-story-preview.ts`'s "DOM-rendered
  story" fallback) exist as the abstraction's second implementation and are exercised only by tests.
- **A story is not a static Chakra-free zone by accident.** The iframe CSP is `default-src 'none'`;
  the sanitizer/validator is the primary defense and the CSP is the backstop, but the iframe is
  same-origin, so this is defense in depth, not isolation.

## Key files

| Task | File |
|---|---|
| Change how a story is sized inside its iframe | `frontend/lib/story-surface/index.ts` |
| Fix a capture that loses styles/fonts/images on a surface | `frontend/lib/story-surface/serialize.ts` |
| Dashboard iframe missing a style | `frontend/lib/dashboard-surface/chrome-css.gen.ts` → `npm run generate-dashboard-chrome-css` |
| Dashboard grid laid out at a stale width | `frontend/lib/dashboard-surface/surface-width.tsx` |
| Saved story grows / re-nests on every save | `frontend/lib/html/serialize-story.ts` |
| A resource is blocked inside the story iframe | `frontend/lib/html/agent-iframe-csp.ts` |
| Fonts missing inside the iframe or in a capture | `frontend/lib/html/mirror-app-styles.ts`, `frontend/lib/html/resolve-story-fonts.ts` |
| The tree being mounted (JSX, registry, interpreter) | `frontend/lib/story-ui/CLAUDE.md` |
| Turning a mounted surface into an image | `frontend/lib/screenshot/CLAUDE.md` |

## Design decisions

**Why dashboards moved into an iframe and questions did not.** Partial self-containment — injecting
the needed styles into a main-document surface — is not enough: the live render still sees
app-document CSS that the serialized copy does not, which flips the direction of the fidelity gap
rather than closing it. **Shadow DOM does not close it either**, since inherited properties and custom
properties pierce a shadow boundary — which is why nothing here attaches one. A same-origin iframe is
the only boundary where live and captured are equal *by construction*, and that is what makes the
dashboard's single closed chrome stylesheet sufficient. Questions, notebooks and reports stay on
`lib/screenshot/serialize-element.ts` plus the environment snapshot: iframe-izing a Monaco-bearing
workbench is high cost for little capture fidelity. The iframe is a fidelity and isolation tool,
**not** a performance one — expect no rendering speed-up from it; the real levers are tile windowing,
per-tile chart cost and fewer observers.

**Chromium does not repaint transformed `foreignObject` content after a relayout.** The DOM and the
layout are correct; the *old pixels* survive until an unrelated invalidation, and transform
transitions freeze mid-animation. Three mitigations carry this, all load-bearing:

- Grid item transitions are switched off inside the surface — `DashboardView` injects
  `[aria-label="Dashboard"] .react-grid-item { transition: none; }`, and tile chrome transitions
  colours and opacity only, never `transform` (react-grid-layout merges those classes onto its
  positioned item).
- `DashboardSurface` nudges the compositor after every committed size change:
  `svg.style.transform = 'translateZ(0)'` for one frame, then cleared.
- Width re-measurement is trailing-debounced 60 ms, so an animated pane toggle costs one relayout and
  one repaint instead of a per-frame grid relayout with a Vega resize on every tile.

Animating a pane width is not something to tune — transformed `foreignObject` content cannot paint
incrementally at all.

**Banned story CSS is one constant with three enforcement points.** `lib/data/story/banned-css.ts` is
the single source behind the prompt rule, the save-time sanitizer over `<style>` blocks and inline
styles (`sanitizeStoryMarkupCss`, wired into `file-markup.ts`), and the Tailwind candidate filter that
runs before compile (`partitionBannedCandidates`). Two bans: `position: fixed` / `sticky`, because
containing-block semantics break inside `<svg><foreignObject>` and a fixed element lands somewhere
else entirely in a capture; and every external-fetch construct — `url()` / `src()` tokens and
`@import`, with only `data:` URIs passing — which is simultaneously an exfiltration guard (authored
CSS firing requests from a guest viewer's browser) and a capture-taint guard (the serialized SVG must
be self-contained). Detection runs on a decoded copy (comments removed, CSS escapes and HTML entities
resolved, lowercased) so `\75 rl(…)`, `POSITION:FIXED` and `url(&quot;…&quot;)` cannot smuggle past,
while the strip removes the original text. Enforcement is declaration-level — a banned declaration is
dropped and its siblings survive, so a save never fails on style content. Nothing else needs
rejecting: `foreignObject` renders with the real engine, so whatever renders live captures
identically.

**`buildSalvaging` is protective, not a bug fix.** A probe of 40+ malformed candidate shapes
(`w-[calc(100%`, unbalanced brackets and quotes, and similar) found that nothing throws in current
Tailwind v4 — so it is not fixing an observed crash. It exists because `withCompiledStoryCss` is
awaited on the `createFile`/`saveFile` path: a future Tailwind that *does* throw on one bad class
token would fail the entire save. So `build()` runs inside a bisect that drops whichever candidates a
compiler rejects, compiles the survivors, and logs what it dropped. It never throws. The banned-CSS
candidate filter is a deliberately separate step *before* the bisect, so a security reject can never
be silently absorbed as a "bad token".

**One converter, no per-type dialect.** `content` (the typed jsonb) stays canonical for every file
type — renders, GUI saves, the query path and the validators are unchanged — and the agent's markup is
a *projection* of it produced by a single uniform converter (`lib/data/story/content-jsx.ts` +
`file-markup.ts`), not a per-type serializer. The TypeBox `*Content` schema does double duty: it
validates the content *and* drives the conversion, deciding what nests, what is an array, how a scalar
coerces, and which field is a `format:'jsx'` body. Storing the markup as the source of truth was
considered and dropped — it buys nothing the projection does not, and costs a storage migration plus a
second truth to keep in sync.

**`content-jsx.ts` is file-type-agnostic by injection, and must stay that way.** Its `SchemaCtx` takes
an optional `jsxField` codec (`toJsx`/`fromJsx` plus the component and HTML-tag allowlists), and
`file-markup.ts` is the only place that binds file type → schema and wires the story-v2 codec in; with
no codec present a `format:'jsx'` field degrades to a plain string leaf. That injection is what keeps
the generic schema-walking converter from importing any specific file type's module, and it is why
`content-jsx` and `story-v2` are siblings rather than a dependency chain. `file-markup` is thin but
not vestigial — keep it thin, and do not let `content-jsx` learn about stories again.

**Legacy-ness is derived from stored content only.** `isLegacyStoryContent`
(`lib/data/story/file-markup.ts`) decides via an attribute-level match for `data-c` on the *existing
stored* HTML (plus a non-empty legacy body), never from incoming markup — a story cannot be declared
legacy by what the agent or the editor sends. That matters because the legacy flag relaxes
`validateJsxSource` to accept the retired component vocabulary; accepting it from input would turn it
into a validation bypass. Legacy stories are frozen rather than migrated: they keep the old compile
path and their live `@import` fonts, and the banned-CSS sanitizer is wired only into the jsx-story
save path.

**Design themes are one canonical palette each, and they pin the colour mode.** `content.theme` on
`StoryContent` and on `DashboardContent` names one of the six `STORY_THEME_NAMES` (`modernist`,
`classical`, `nocturne`, `organic`, `broadsheet`, `industry`; the enum lives in
`lib/validation/atlas-schemas.ts`, the registry in `lib/data/story/story-themes.ts`). A theme is CSS
custom-property *values* and nothing else — the shadcn token set (`--background`/`--foreground`/
`--card`/…, `--radius`, the font families, `--chart-1..5`) plus a small element-level layer for
personality — which is how a theme change recolors Vega charts without touching a spec. Components and
utility classes are identical across all six (the shadcn/tweakcn convention), so the emitter appends
tiny `[data-theme="<name>"]`-scoped blocks to a story's compiled sheet and switching a theme needs no
recompile. **Themes set defaults only** — authored and agent CSS is injected after the compiled sheet
in document order and wins; a theme that starts shipping component overrides or `!important` breaks
both properties at once. A theme is a self-contained design rather than a light/dark pair, so a themed
document renders the same in a light or a dark app: the surface mode is
`storyThemeMode(theme) ?? content.colorMode ?? the app mode`, which keeps chart ink and embed chrome
legible on the theme's fixed palette.

**Charts are Vega or they are wrong, and that is enforced by prompt and rubric rather than a lint.**
The failure mode is an agent hand-building a chart out of HTML and CSS divs. Enforcement is (1) the
`skill_stories` / `skill_questions` rule that anything visualizing data must be a `<Question>` embed
carrying a `<viz>` envelope, with reference images reproduced as Vega-Lite specs — HTML stays correct
for stat tiles, callouts and layout — and (2) a rubric line ("no hand-drawn charts — all data visuals
are live embeds"), because a fake chart is visually obvious to the judge. A save-time HTML heuristic
was considered and dropped: it is weaker than both, since any div-with-widths pattern either misses
real cases or blocks legitimate layout.
