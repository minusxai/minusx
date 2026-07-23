# Renderer V2 — One Render Stack for Questions, Dashboards, and Stories

**Status: EXECUTED — all seven phases shipped on `feature/improved_renderer_v2` (PR #641). Phase checkboxes below record what landed, with measurements and the corrections found during implementation. §9 remains the decision log; review rounds 1–2 closed every decision before execution.**

**Post-execution user-testing fixes (all red-first, all matrix-guarded on 3 engines):**
1. **Dark dashboard captures rasterized with LIGHT chrome** — the surface serializer stamped the
   color-mode class on the foreignObject root, which IS the `[data-mx-theme-host]`; the dark
   token block is the DESCENDANT selector `.dark [data-mx-theme-host]`, so it never matched in
   the detached copy (live it matches via `<html class="dark">`). Mode class now lands on the
   cloned `<svg>` ancestor; new dark-capture pixel guards in the matrix (`b2` + `modevars`).
2. **Markers widened the agent image** — the canvas gutter prepended a 40px strip, so the image
   had different geometry than the page. Markers are now a pure OVERLAY (badges + full-width
   dashed band lines, identical to the live dev preview); dashboards carry `pl-10` default left
   padding as the badge column's home. `drawMarkerGutter` never changes canvas dimensions
   (contract test).
3a. **Second user-testing round:** sidebar toggles now SNAP (the 300ms margin/width transitions
   in LayoutWrapper/Sidebar/RightSidebar are gone — animating the pane width forced per-frame
   grid relayouts + Vega resizes for the duration, and transformed foreignObject content can't
   paint incrementally anyway); surface measure debounce trimmed to 60ms. Dashboard tiles are
   SOLID `bg-card` surfaces (bg-muted/40 was near-invisible on dark — the "horrendous" barren
   loading look). Markers are now PIXEL-PARITY with the live overlay: same 22px/13px badge
   geometry and colors drawn at content scale in the reserved `MARKER_GUTTER_CSS_PX` (40px,
   pl-10) gutter that dashboards, notebooks (pre-existing 40px), and reports carry — with a
   14-output-px legibility floor that still fits the gutter at agent scale; stories keep their
   authored margins (injecting structural padding would shift every curated story). Dev-loop
   note: several "regressions" in this round were a STALE turbopack CSS chunk (classes present
   in DOM, absent from served CSS) — restart the dev server before diagnosing.
3b. **Third user-testing round — capture fidelity (DOM vs image deltas), all red-first:** the
   detached copy loses ENVIRONMENT, and every observed delta traced to one of three leaks:
   (a) inherited text color/font metrics (un-colored pivot text rasterized BLACK on dark tiles)
   → both serializers now bake a computed-style snapshot (color/font/line-height) of the live
   root onto the clone wrapper; (b) root-scoped CSS vars from `<html>` classes (next/font's
   `--font-jetbrains-mono` variable classes) — the surface serializer now carries the html
   classes like the element serializer always did; (c) `@font-face` src urls are RELATIVE TO
   THEIR SHEET (`url("../media/x.woff2")` inside /_next/static/css/…) and `collectDocumentCss`
   resolved them against the PAGE url → 404 → no webfont in any capture → wider fallback mono →
   the clipped-caption / oversized-numerals report. Fixed with per-sheet absolutizing
   (`lib/html/css-urls.ts`, shared with the story mirror — extracted because the ui test setup
   mocks mirror-app-styles wholesale, which had silently un-defined the import). Verified by a
   live side-by-side (Top Level Metrics, tutorial): numerals, captions, pivot text, markers all
   match the DOM. Perf verified: settled-page cold capture ≈3.0s (≥250ms readiness settle +
   one-time font inlining, dev CSS), instant on repeat (one-slot cache); the raw
   serialize+rasterize pipeline measures 1–19ms on the matrix grid even at 6× CPU throttle —
   the cost is I/O-shaped (font fetches), not CPU-shaped, so older machines track the cold case.
3. **Stale-paint bug on relayout (the "broken dashboard" and much of the sidebar jank)** —
   Chromium does not repaint transformed foreignObject content after a relayout (DOM/layout
   correct, old pixels survive until an unrelated invalidation like a scroll), and transform
   TRANSITIONS freeze mid-animation. Fixes: RGL tile transitions disabled inside the surface
   (tiles snap; tile chrome transitions colors only), SvgPageSurface forces a compositor nudge
   (translateZ toggle) after each committed size change, and surface measuring is
   trailing-debounced (120ms) so an animated sidebar toggle costs ONE relayout + repaint instead
   of ~20 per-frame grid relayouts + Vega resizes. Screen-pixel (screenshot, not serializer)
   staleness guard added to the matrix.

The goal: retire Chakra from the file-content surfaces (Question, Dashboard, and
the embeds they lend to Stories), re-use the Story machinery (Tailwind + vendored shadcn +
theme tokens + SVG-serializable surface + serialization capture), extend app-state **page markers
to dashboards**, and reduce the number of parallel rendering/capture systems we maintain.

This document reports the current state (verified against the merged `main`), corrects four
assumptions from the brief and review, records the decisions, and commits a phased plan.

---

## 1. Corrections first — assumptions the codebase has already moved past

### 1.1 "Dashboards still slow down when we get the image" — mostly fixed already

The slow path you remember (`buildChartAttachments`: re-render every chart off-screen through
ECharts on **every message send**) **no longer exists**. It was deleted along with its cache
machinery; `lib/chart/chart-attachments.ts` now only keeps `extractChartEntries` for the DevTools
"Agent image" preview. What happens today on send from a question/dashboard page:

- **One** screenshot of the whole rendered file view, taken **lazily at send time** (nothing
  speculative — the old warm-on-change behavior was removed after measuring ~4s freezes on an
  11-card dashboard under snapdom).
- It goes through the same serialization pipeline stories use (`captureFileViewBlob` →
  `serializeElementToSvg` → data-URL SVG → canvas → 512px JPEG), with a one-slot cache keyed by
  content+results+color-mode, so re-sending an unchanged view is instant.
- As of this branch it is also **readiness-gated** (`data-mx-busy`), so it never captures
  half-hydrated tiles.

So "port dashboards to the svg renderer + fast image stuff" is **already true for the capture
side**. What is *not* ported, and is the real remaining fidelity/cost gap:

| Gap | Cause | Consequence |
|---|---|---|
| Chakra styling | Tile chrome + viz states are Chakra/Emotion | Captures need the whole app CSSOM inlined + the `chakra-theme` host stamp; stories need `mirrorAppStyles` |
| No markers | `isStoryAppState` gate | Agent gets no spatial map of a dashboard (see §1.2 — cheap to fix) |
| ECharts rollback path still alive | `vizRenderer:'echarts'` toggle + the plotx canvas stack | Dead weight + a canvas-fidelity trap if anyone flips the toggle (see §1.4) |

### 1.2 "Markers for dashboards need the Story treatment" — no, they're nearly free today

The marker gate excludes dashboards with the comment "questions/dashboards can have internal
scroll or a fixed height." **For dashboards this is factually stale.** Verified: dashboards render
`h:'none'` (`lib/ui/file-metadata.ts`) — the grid renders at **full content height in page flow**
(react-grid-layout sets explicit container height), and the scroll container is the ancestor
`VStack` in `FileLayout.tsx`. So `offsetHeight` on `[data-file-id]` already equals the full
document height — exactly the property the marker system needs. Questions really are internally
scrolled (`h:'100vh'`), and per the brief they don't need markers.

**Conclusion: dashboard markers do not require the iframe, the SVG surface, or the Chakra
migration.** They require replacing `isStoryAppState` with the declared `markers` flag in
`FILE_TYPE_METADATA` (§2b — story, dashboard, notebook, report, alert, and the run outputs), and teaching the
`<Viewport>` pointer to read the `FileLayout` scroll container's `scrollTop` instead of assuming
the story layout. This is a small, standalone change (Phase 1).

### 1.3 "Iframe rendering will make dashboards faster" — cmiiw honored: it will not

The iframe is a **fidelity and isolation** tool, not a performance tool. What actually makes
dashboards feel sluggish (measured facts from the code):

- **N chart views** for N chart tiles (Vega views by default — see §1.4; the ECharts numbers
  below apply only to the rollback path), each spec-compile/render on the main thread.
- **Multiple ResizeObservers per tile** (the ECharts path measures 2/tile + the grid's
  `WidthProvider`; the Vega path's per-tile observer count should be measured, not assumed).
- **No virtualization**: every tile mounts (there's only `requestIdleCallback`-staggered body
  mounting, ~`500 + 150·i` ms — scheduling, not windowing). Off-screen tiles render fully.
- **Emotion/Chakra runtime**: per-tile Menu/Portal/Tooltip trees, style recalc over the app-wide
  CSSOM, and the historical waste documented in the code itself ("ChartHost was 100% wasted
  (40/40 renders)" before memoization).

Moving this tree into an iframe changes none of those numbers — the same charts, observers, and
tiles run inside; and until Chakra is gone the iframe *adds* cost (`mirrorAppStyles` re-serializes
the entire app CSSOM into the frame on a MutationObserver). The honest perf levers, independent of
where the tree mounts:

1. **Tile windowing** (render only visible tiles + overscan; keep layout ghosts for the rest) —
   the single biggest lever for many-tile dashboards.
2. **Per-tile chart cost** — profile the Vega view lifecycle per tile (spec compile, data prep,
   observer wiring); memoize spec/data derivation the way the code already memoizes ECharts
   options.
3. **Fewer observers** — consolidate to one ResizeObserver per tile.
4. **Killing the Emotion runtime** on this surface (the Tailwind migration itself) — static CSS,
   no style injection/recalc churn per mount.

The doc therefore treats "make dashboards faster" as its own axis (§6), not a side effect of the
iframe.

### 1.4 "We must use Vega everywhere" — we already do; the work left is a deletion

Verified: `vizRenderer` defaults to `'vega'` (`store/uiSlice.ts:74`), and under it **every chart on
questions and dashboards draws through `<VegaChart>`** — which hard-forces `renderer:'svg'` and
reads the design-theme chart tokens. Legacy charts whose truth is still `vizSettings` render
through a just-in-time V1→Vega bridge (`lib/viz/from-vizsettings.ts`) — render-only, nothing
written back. Table and pivot deliberately render on the DOM tier (native `<table>` +
tanstack-virtual), which is correct and capture-friendly.

ECharts is NOT the production chart engine anymore. It survives in three places only:
1. The `'echarts'` value of the `vizRenderer` rollback toggle (localStorage-persisted).
2. The plotx canvas stack behind it (`ChartHost`/`EChart`/`BaseChart` + per-type Plot components).
3. The off-screen DevTools "Agent image" renderer (`ChartImageRenderer.client`, canvas).

So the directive "use Vega, even for Questions and Dashboards" translates to: **declare rollback
confidence, then delete the ECharts path** — a deletion phase, not a migration (§5 Phase 2). Until
it's deleted, captures keep the canvas-stamping fallback purely as defense.

---

## 2. Current state — the three renderers we actually maintain

| Surface | Body stack | Charts | Capture | Themes | Markers |
|---|---|---|---|---|---|
| **Story (jsx)** | Tailwind + vendored shadcn via interpreter, in iframe `<svg><foreignObject>` | Vega, **SVG forced** | serialize live `<svg>` (`serializeStorySvg`) | 6 themes, `[data-theme]` | yes |
| **Dashboard** | Chakra + react-grid-layout, main document | **Vega SVG (default)** via the V1→V2 bridge; ECharts canvas only behind the rollback toggle | generic clone serializer (`serializeElementToSvg`) | none | no (gated) |
| **Question** | Chakra 3-pane workbench (Monaco, config panels), main document | **Vega SVG (default)**; table/pivot on the DOM tier | generic clone serializer | none | no (n/a) |

Shared already (the good news):

- **All pure chart/data logic is Chakra-free**: `lib/chart/*` (option builders, pivot, formats,
  themes), `lib/viz/*`, query hooks, `EChart.tsx` itself (a raw div + echarts). The migration is a
  **chrome** migration, not a viz-engine rewrite.
- **The vendored shadcn kit is plain React** (`lib/story-ui/components/`, 15 components, cva +
  Tailwind + Radix). Nothing binds it to the interpreter or the iframe — it is importable from any
  component today. Missing for our needs: `DropdownMenu` (the Menu replacement), `Select`,
  `Switch`, `Checkbox`, `Input` — standard shadcn additions.
- **The Tailwind compile pipeline is generic**: `compileStoryCss` takes a candidate-class union
  (that's how component recipe classes already work — `STORY_UI_RECIPE_CLASSES`, generated by
  scanning component sources). An app-side surface can either extend that union or simply be part
  of the app's own Tailwind build.
- **Themes are portable**: a theme is a `[data-theme]` variable block + a `.dark` ancestor +
  the `@theme inline` token mapping. Nothing story-specific.
- **One capture pipeline already exists** for everything (`captureFileViewBlob`), with two
  serializers behind it (live-svg for stories, clone for the rest). Both are readiness-gated and
  guarded by the three-engine capture matrix.

Counted Chakra surface to replace (from the component inventory):

- **Dashboard tree**: `DashboardView` (579 L, Box-only), `SmartEmbeddedQuestionContainer` (331 L,
  the interactive one: Menu/Portal/IconButton/Tooltip), `TextBlockCard` (285 L), `ParameterRow`
  (126 L), `QuestionBrowserPanel` (~330 L). Primitive set: **Menu, Tooltip, Portal, IconButton,
  Button, Spinner** — small.
- **Question tree**: `QuestionViewV2` (1,237 L, hand-rolled resizable 3-pane), `QuestionVisualization`
  (633 L dispatcher), `SqlEditor` (727 L, Monaco host), plus the config-panel long tail
  (`VizConfigPanel`, `AxisBuilder`/`AxisComponents` ~39 KB, Vega panels ~1,100 L, table panels).
  Primitive set adds **Switch, Checkbox, Select** — the config panels are the bulk of the work.
- **Shared blast radius**: `NotebookSqlCell` is a thin recombination of the same parts
  (`SqlEditor`, `ParameterRow`, `QuestionVisualization`, `VizConfigPanel`) — notebooks migrate
  automatically when the shared parts do. `PivotTable` is the one Chakra-table user (TableV2 is
  already native `<table>` + tanstack-virtual).
- **There is no app-side shadcn today**: `components/ui/*` are Chakra re-exports. The vendored
  story kit becomes the seed of the real one.

---

## 2b. Which file types get this (and which get markers)

The unified stack targets **rendered-document file types** — things a reader scrolls through and
the agent screenshots. Markers become ONE declared property in the existing single source of
truth: **a `markers: true` flag in `FILE_TYPE_METADATA`** (story, dashboard, notebook, report,
alert, and the run outputs `alert_run`/`report_run`/`context_run`), with a guard that a flagged type must also be `h:'none'` — markers are only *meaningful*
on full-content-height page flow. `isStoryAppState` is deleted, replaced by reading that flag.

> Why a flag and not the bare `h === 'none'` heuristic: review caught that `h:'none'`
> OVER-matches — `connection`, `context`, `conversation` and most admin types also declare it,
> which would put a numbered gutter on admin/form captures the scope table excludes. Deriving
> intent from two orthogonal properties was the bug; declaring it in the SSOT is still "one rule,
> no scattered whitelist" — the list lives where every other per-type fact already lives.

| File type | In scope | Design stack | Markers (`metadata.markers`) | How it gets there |
|---|---|---|---|---|
| **story** | shipped | Tailwind/shadcn (done) | yes (done) | — |
| **dashboard** | yes | Phase 3 | yes — Phase 1 | re-skin first, then grid onto the B2 surface (Phase 4, spike PASSED §7.2) |
| **notebook** | yes | free via shared parts | yes — Phase 1 (vertical flow) | `NotebookSqlCell` is recombined `SqlEditor`/`QuestionVisualization`/`ParameterRow` — migrates when they do. NOTE: `supported: false` today — enabling notebooks is NOT part of this campaign; the flag is inert until they ship (stated explicitly per review, not silently) |
| **question** | yes | Phase 3 (viz states) + Phase 5 (workbench) | **no** (internally scrolled; per brief, fine) | shared parts + config-panel long tail |
| **report** ("Digest", future) | yes | build it ON this stack from day one | yes | never write a Chakra version |
| **alert** | yes | kit re-skin (small view) | yes | alongside Phase 5 |
| CodeView / TransformationView | yes — but these are VIEWS, not FileTypes (no `FILE_TYPE_METADATA` entries — review correction) | kit re-skin | n/a (no metadata entry to flag; Phase 1 tests must not expect one) | alongside Phase 5 |
| **alert_run / report_run** | yes — read-only rendered run outputs (`FileView.tsx` READ_ONLY_FILE_TYPES), `h:'none'` | kit re-skin (read-only views) | **yes — flagged** (review caught these as silently unlisted; run outputs are exactly what an agent screenshots) | Phase 1 flag; re-skin alongside Phase 5 |
| **context_run** | probably — `h:'none'`, but it is NOT in READ_ONLY_FILE_TYPES (review correction: the earlier citation was wrong) | kit re-skin | flag ONLY after verifying how it actually renders — a Phase 1 checkbox, not an assumption | Phase 1 verifies, then flags or excludes explicitly |
| connection, context, config, styles, users | **no — explicitly out of scope** | stay Chakra | no flag (admin/form surfaces) | outside this campaign (scope boundary, §8.3) |
| explore + conversations pages, app shell | **no** (app pages, not file types — `conversation` is no longer in the FileType schema) | stay Chakra | no flag | same scoping rule Story V2 used |

---

## 3. The decision space

Three independent axes — the brief bundled them; they were decided separately, and all three
are now DECIDED:

**Axis A — Design stack**: Chakra → Tailwind + shadcn (vendored kit + tokens/themes).
**Axis B — Render surface**: main document vs `<svg><foreignObject>` surface vs full iframe.
**Axis C — Chart renderer**: Vega everywhere (already the default) — delete the ECharts rollback path.

### Axis A: Chakra → Tailwind/shadcn — DECIDED: yes

This is where "reduce development surface, maximize reuse" is real:

- One component kit (extend `lib/story-ui/components/` and promote it to `components/kit/` or
  similar), one token system, six themes usable on dashboards.
- Deletes, once complete: the Chakra CSSOM mirroring that dominates `mirrorAppStyles` (409 KB measured live on the
  tutorial story page during this session's capture-parity work — a measurement, not a code
  citation; re-serialized into every story iframe + MutationObserver churn; a minimal font/lazy-style shim
  survives — see §4), the `chakra-theme` capture host stamp in both serializers, the Chakra
  wrapper layer `components/ui/*`, and eventually the Chakra/Emotion dependency from the render
  path entirely.
- The embeds problem from the capture-parity work disappears *structurally*: story embeds would be
  story-stack components, themed by the story's `[data-theme]`, capturable with zero special
  casing.
- The groundwork is unusually good: containers are already Redux-free-view separated (ESLint
  `RESTRICT_VIEW_REDUX` covers `QuestionViewV2` and `DashboardView`), and the heavy logic is
  already pure.

Cost honesty: the question config panels are the long tail (~5–6 KLoC of Chakra chrome). The
dashboard tree is comparatively small. Ordering matters (dashboard + embeds first, question
workbench last).

### Axis B: render surface — DECIDED: B2 for dashboards, B1 for questions (iframe rejected)

What the story iframe actually buys stories: (a) a document to `doc.write` agent-authored HTML
into with its own CSP (**sanitization concern — does not apply to dashboards/questions**, whose
content is app-rendered React from structured JSON, never agent HTML); (b) style isolation in
BOTH directions (authored story CSS can't leak out); (c) `@import` web-font loading; (d) a
place to hang the `<svg><foreignObject>` surface so captures serialize live DOM.

Only (d) — and weak isolation benefits — apply to dashboards. And critically, **the SVG surface
does not require the iframe**: `mountStorySurface`'s own docs note "isolation is the iframe's job
either way" — the `<svg><foreignObject>` wrapper can mount in the main document. That yields:

- **Option B1 — main document, no special surface (status quo)**: capture keeps using the clone
  serializer. Fine, already works; capture fidelity is one clone away from live instead of
  serializing live DOM.
- **Option B2 — main-document `<svg><foreignObject>` surface** around the dashboard grid:
  captures serialize the live surface exactly like stories (`serializeStorySvg` generalizes),
  no iframe costs, no nested React root, Monaco/drag/portals stay in one document. Known quirks:
  `position:fixed` is broken inside foreignObject (Radix popovers already solved via
  `STORY_FLOATING_CSS`; menus portal OUTSIDE the svg — fine, they're transient chrome that
  shouldn't capture anyway). Grid drag/resize/capture inside foreignObject is PROVEN — §7.2.
- **Option B3 — full iframe like stories**: adds a nested React root, provider re-bridging,
  event-boundary work for drag/drop and Monaco, a second sizing contract
  (`autoSizeStorySurface` assumes single-column reflow; a grid wants fixed-height semantics),
  and until Chakra is fully gone, `mirrorAppStyles` in another surface. Buys, over B2: theme/style
  isolation from the app page. That's worth having only *after* the dashboard is fully on the
  story stack — and maybe not even then.

**Decided:** B2 for dashboards (core spike PASSED — §7.2; re-proof with real chrome in Phase 4), B1 (no change) for questions. The
question page is an editing workbench (Monaco, panels, internal scroll); nothing about it wants a
serializable surface badly enough to justify foreignObject quirks, and its capture path already
works.

### Axis C: charts — Vega everywhere is the DECIDED end-state; the work is deleting ECharts

Per §1.4, Vega-SVG is already the default engine on every surface, so this axis is not a
migration choice but a rollback-retirement schedule:

- **Now**: nothing to flip. Stories, dashboards, and questions all draw through `<VegaChart>`
  (SVG) by default; capture parity holds without canvas stamping on this path.
- **Retire**: the `vizRenderer:'echarts'` toggle, the plotx ECharts stack behind it
  (`ChartHost`/`EChart`/`BaseChart` + per-type Plots), and `ChartImageRenderer.client` (the
  DevTools per-chart preview moves to the capture path). Pre-deletion bar (Phase 2): the visual
  grading gallery + telemetry-verified short bake — bridge COVERAGE and SCALE are already proven
  (§7.1: 15/15 types; 5k-point scatter in 52ms), so the large-series watch item is closed.

---

## 4. What gets DELETED when this completes (the surface-reduction ledger)

| Today | After |
|---|---|
| `mirrorAppStyles` + its caller's re-run machinery (the MutationObserver + 250/1500/3000ms timers live in `AgentHtml.tsx`, not the mirror itself) | **shrunk, not gone** (review correction): the Chakra CSSOM mirroring — the bulk — goes, but the mirror also carries app `@font-face` rules and non-Chakra styles lazily injected into the main `document.head` when tiles mount. A minimal static injection (fonts + lazy chart styles) survives, or those duties move into the compiled recipe union — Phase 3's measured checkpoint decides the exact residue |
| `chakra-theme` host stamp in both serializers (+ its matrix fixture stays as a regression guard) | stamp gone |
| `components/ui/*` Chakra wrappers | one shadcn kit |
| The entire ECharts rollback path: `vizRenderer` toggle, `ChartHost`/`EChart`/`BaseChart`, per-type plotx Plots, ECharts deps | gone — Vega is the only chart engine (§1.4) |
| `ChartImageRenderer.client` off-screen ECharts renderer (DevTools preview only) | replaced by the capture path |
| Two chart chrome implementations (app Chakra tiles vs story theming) | one, themed |
| Emotion runtime on file-content pages | static Tailwind CSS |

Kept deliberately: react-grid-layout (drag/resize is orthogonal to styling), the clone serializer
(still needed for anything not on an svg surface), capture-side canvas stamping (generic defense
for residual canvas content), Chakra app-shell chrome outside file content (sidebars, dialogs —
out of scope, exactly like Story V2 scoped it).

---

## 5. Committed phases (independently shippable; ONE ordering constraint: re-skin (3) before surface swap (4) — see Phase 3 note)

### Phase 1 — Markers for every flagged document type — ✅ DONE
- [x] `markers: true` flag in `FILE_TYPE_METADATA` (story, dashboard, notebook, report, alert,
      alert_run, report_run); `isStoryAppState` DELETED, replaced by `markersEnabledForAppState`
      reading the flag; invariant test: every flagged type is `h:'none'`.
- [x] `context_run` explicitly EXCLUDED with an in-code comment: verified zero component
      references — nothing renders it today; flag it when it gains a view.
- [x] Viewport pointer: verified ALREADY container-agnostic (`-getBoundingClientRect().top` is
      viewport-relative whichever ancestor scrolls — stories scroll in the same FileLayout VStack
      dashboards do); pinned by a new characterization test (band 3 at scrollTop 900 with
      window.scrollY 0).
- [x] Red-first tests: flag gate (incl. NO markers for connection/context — the over-match
      finding), conversation-gone assertion, gutter-request-per-type test, dashboard overlay
      mount/absence ui tests. All green; full suite 5,899 passed.
- [x] Dev overlay mounts on dashboard/notebook/report views (the flagged types WITH `data-file-id`
      roots), OUTSIDE the captured subtree — a first capture showed the overlay leaking into the
      image (mounted inside the subtree); re-wrapped to the StoryView contract and re-verified:
      capture carries ONLY the baked gutter. `alert` is flagged but its view has no
      `data-file-id` stamp yet — overlay + capture activate when it gains one.
- [x] Agent-facing wording: verified the marker/`<Viewport>` prompt text is ALREADY generic
      ("the app-state screenshot has faint numbered markers…") — no story-specific language, no
      change needed.
- [x] `conversation` removed as a file type: metadata entry (⇒ out of the `FileType` union),
      `FileView` READ_ONLY entry, '/logs' path mapping, Sidebar nav metadata reference,
      DevToolsPanel analytics branch, `ConversationContainerV2` + its `fileComponents` mapping
      DELETED. KEPT on purpose: `migrate-conversations-v3` + `documents-db`/`files.server` legacy
      handling (typed casts + comments) for un-migrated rows.
- [x] Browser-verified on the dev server: live overlay chips on the tutorial dashboard; DevTools
      Markers capture of the dashboard shows the numbered gutter baked in, overlay NOT captured.

### Phase 2 — Retire the ECharts rollback path — ✅ DONE
- [x] Coverage de-risked (§7.1: 15/15 types; 5k scatter 52ms) + VISUAL grading executed: gallery
      of all 15 types, ECharts vs Vega side-by-side — **15/15 keep, 0 fix**. Vega strictly better
      on line/area/scatter (sorted date axes; ECharts drew a CATEGORICAL scatter x-axis) and
      waterfall (+delta labels); single_value/point_map/geo rendered ONLY on Vega (ECharts SSR
      returned null). Minor notes: vega pie lacks slice % labels, legend can wrap-truncate —
      shipped baseline, unchanged by the deletion.
- [x] Bake telemetry SKIPPED AS MOOT — the user ordered full no-deferral execution, so the toggle
      was deleted outright; an event on a deleted path measures nothing. Rollback = git revert.
- [x] Geo assets in no-origin contexts FIXED on the Vega path: `setGeoAssetFetcher` seam +
      `installFsGeoAssetFetcher` (`lib/viz/geo-assets.server.ts`, installed by render-viz-image),
      red-first tests incl. a full headless choropleth render. The ECharts fetch site died with
      the stack.
- [x] DevTools "Agent image" button DELETED (it previewed the removed per-chart pipeline; Get
      image + Markers/512px IS the agent preview) — red-first test.
- [x] V1 pivot rerouted: renders `VizPivotView` via the same JIT bridge V2 uses (ChartBuilder was
      its last renderer) — red-first test.
- [x] Column-stat minis (`MiniHistogram`/`MiniBarChart`) rewritten as plain hand-rendered SVG —
      they were the last live ECharts consumers — red-first tests.
- [x] DELETED: `vizRenderer` toggle (uiSlice field/action/selector, settings UI, DataLoader
      hydration + `vizRenderer_v2` localStorage key now actively removed), plotx ECharts stack
      (ChartBuilder, ChartHost/EChart/BaseChart, 13 Plot components, GeoPlot/LeafletMap,
      useChartContainer), `ChartImageRenderer.client`, `render-chart.ts`/`render-chart-svg.ts`/
      `echarts-init.ts`/`chart-utils.ts`/`chart-annotations.ts`/`chart-builders/`, the server
      renderer's ECharts crash-fallback, and the `echarts` package dependency.
- [x] Engine-free survivors extracted: `chart-theme.ts` (palettes/fonts/light-dark tokens),
      `renderable-types.ts` (RENDERABLE_CHART_TYPES + getChartHeight), `svg-to-jpeg.ts`
      (Resvg/Sharp composer, new characterization test), `getTimestamp` → chart-format.
      Benchmark tool migrated to the bridge + `renderVizEnvelopeToJpeg`.
- [x] CLAUDE.md updated to the post-deletion reality. Browser-verified: dashboard (all Vega
      tiles + markers), question workbench (Vega chart, viz selector) — only the pre-existing
      hydration-mismatch console noise, nothing new.

### Phase 3 — Dashboard + embed chrome to Tailwind/shadcn (the Chakra exit, part 1) — ✅ DONE

**Ordered BEFORE the surface swap deliberately** (review finding): moving a still-Chakra grid
onto the live-svg surface would put the app-CSSOM-inlining + `chakra-theme`-stamp cost — the
exact thing this plan deletes — onto the story-style capture path for the interim. Re-skin
first; then the surface swap carries only compiled Tailwind. The §7.2 spike used a bare grid,
so the surface phase re-proves with the REAL (post-re-skin) chrome anyway.

- [x] FIRST: the main-document Tailwind wiring — DONE: (a) generated `app/theme-tokens.css`
      (`npm run generate-app-theme-css`, drift-tested) with `@theme inline` mapping + neutral
      values scoped under `[data-mx-theme-host]` + all six `[data-theme]` blocks, app chart
      palette substituted into the host blocks (visual bar); (b) `@source "../components"` +
      `@import "tailwindcss" important` (Chakra's unlayered element resets beat plain
      `@layer utilities`); (c) conflict check shipped as the DevTools `KitPreviewPanel`
      (permanent tripwire) — kit renders correctly beside Chakra chrome in both modes.
- [x] Promote the vendored kit — DONE: `git mv` → `components/kit/` (story-ui re-exports keep
      old imports alive); added dropdown-menu, select, switch, checkbox, input (inline SVG
      icons, no lucide-react).
- [x] Re-skin — DONE: `SmartEmbeddedQuestionContainer` (kit DropdownMenu, 5 characterization
      tests), `QuestionVisualization` states (error/empty/loading + data-mx-busy spinner),
      `TextBlockCard`, `ParameterRow`/`ParameterInput` (pill chrome; child widgets are
      Phase 5), `StoryParamControl`, `DashboardView` (tile borders, ghost grid, theme
      stamping). Blue→Red→Blue against existing suites; browser pixel-parity checked.
- [x] `PivotTable` off Chakra `Table` — DONE: native `<table>/<thead>/<tbody>` across
      `PivotTable` + `PivotTableHeader` + `PivotTableBody` + `PivotTableTooltip` +
      `VizPivotView`; base chrome (padding/borders/zebra/scrollbar) ships as a
      low-specificity `:where()` stylesheet INSIDE the component so envelope css overrides
      still win and the rules travel into stories/foreignObject; compact-mode tooltip moved
      to the kit (Radix) Tooltip rendered inside the `<td>` (portal-free, story-safe; new
      red-proven UI test); heatmap flat-domain fallback made concrete (`color-mix` teal).
      22-test characterization suite blue; pivot files added to `EMBED_CHROME_FILES`.
- [x] VISUAL BAR — HELD: unthemed dashboards keep the app palette (`--chart-1..5`
      substituted in the neutral host token block, pinned by test) and neutral grays match
      the previous look (browser-compared on the seeded dashboard before/after re-skin).
- [x] Wire dashboard surface tokens — DONE: `DashboardContent.theme`
      (optional/nullable, `STORY_THEME_NAMES`) in atlas-schemas; `DashboardView` stamps
      `data-theme` on the grid root; browser-verified end-to-end with `nocturne`.
- [x] Update `skill_dashboards` — DONE: documents `theme` + the six names in prompts.yaml.
- [x] ESLint no-`@chakra-ui` ban — DONE (`eslint.config.mjs`): kit + all re-skinned files
      including the five pivot files; validate-enforced.
- [x] Story payoff checkpoint — MEASURED (dev build, seeded story with embeds): the mirror
      carries ~455KB into each story iframe — 237KB compiled app CSS bundle (Chakra static
      theme + Tailwind + tokens; dev-unminified), **195KB emotion runtime rules (43%)**, 20KB
      `@font-face` (72 rules), 18KB misc. Verdict: the mirror CANNOT shrink yet — embeds still
      reach Chakra through the flat `TableV2`, `TableBottomBar`, `DrillDownCard`, `ChartError`,
      and the param child widgets (all Phase 5 scope). Post-Phase-5 the emotion runtime block
      and the Chakra share of the bundle drop out; the surviving duties are fonts + the
      `APP_STYLES_BASE_CSS` guards, which move to a static injection in 6a. Re-measure at 6a.

### Phase 4 — Main-document SVG surface for the dashboard grid (Option B2) — ✅ DONE
- [x] ~~Core spike~~ **DE-RISKED (§7.2): real react-grid-layout inside `<svg><foreignObject>` in
      the main document PASSES on Chromium + WebKit + Firefox** — layout correct, drag commits a
      layout change, resize commits, and the live-svg serialize→rasterize capture renders all
      tiles untainted with matching pixel counts across engines.
- [x] Spike: popover/menu OVER the surface — PROVEN (matrix `b2-popover` fixture, 3 engines): a
      fixed-position portal over the svg receives clicks, the surface below stays interactive,
      and the portal is EXCLUDED from the serialized capture.
- [x] Spike: TEXT EDITING inside the surface — PROVEN (matrix `b2-edit`, 3 engines): input
      focus/typing/caret position, contenteditable typing, and the typed value BAKED into the
      capture (form stamping through `serializeSurfaceSvg`).
- [x] Spike: `position:sticky` inside foreignObject — PROVEN (matrix `b2-sticky`, 3 engines):
      a sticky header pins at the top of a scrolled foreignObject container (delta ≤ 2px).
- [x] Check: text SELECTION works across foreignObject content (triple-click selects), and the
      content is exposed to the ACCESSIBILITY tree (role=region resolvable by name) — matrix
      `b2-edit`, 3 engines. Find-in-page rides the same AX/text exposure; not separately
      automatable in the harness, verified implicitly by selection + role resolution.
- [x] §7.2 re-proof with REAL machinery — the b2 fixtures drive the SHIPPED `SvgPageSurface`
      component + SHIPPED `serializeSurfaceSvg` + the dashboard's real `WidthProvider(Responsive)`
      grid: container-width layout inside foreignObject, real mouse drag/resize COMMIT, capture
      untainted with every tile present INCLUDING a token-backed tile (`--chart-1` under
      `[data-mx-theme-host]` — the shadcn token chain proven in the serialized copy). One finding
      worth keeping: RGL's mount/drag transition makes position probes time-dependent (~1s crawl
      under headless load) — the fixture disables it; the app keeps it (cosmetic).
- [x] Promoted into `capture-matrix.ts` (`b2-surface-matrix.ts` + `b2-surface-drivers.tsx`, runs
      under `npm run capture-matrix`); `DashboardView` mounts its region INSIDE the surface
      (`[data-file-id] > SvgPageSurface > [aria-label="Dashboard"][data-theme]` — the theme stamp
      travels with the serialized copy), and `captureElementBlob` branches to the live-svg
      serializer via `findSurfaceSvg`. Browser-verified on the seeded dashboard: render, Get
      image with markers baked (badges 1–4), sidebar-toggle resize re-track, edit-mode drag
      commit + discard. Bonus fix caught by the red test: `serializeElementToSvg` (still used by
      question/notebook/report) now stamps `[data-mx-theme-host]` nested inside the mode wrapper —
      without it every re-skinned token-backed style rasterized unresolved in captures.

### Phase 5 — Question workbench to Tailwind/shadcn (COMMITTED scope — user decision) — ✅ DONE
**Deferral was proposed by review and REJECTED by the user: the final outcome (§8) is every
in-scope file type fully Chakra-free, so this ships with the campaign, not "opportunistically."**
It is the largest block of hours (~5–6 KLoC of chrome re-skin) with LOW technical risk — Monaco
is style-agnostic, the panels are ordinary React, every needed primitive is standard shadcn. Not
ZERO risk (review nit, accepted): `AxisBuilder`'s drag-drop and the `PivotTable`→native-table
move are behavior-heavy — both get characterization tests before the re-skin (Blue→Red→Blue).
- [x] DONE — the full workbench + rendered-document tree is Chakra-free (~60 files converted,
      each Blue→Red→Blue against the existing characterization suites, prop contracts and
      aria-labels preserved): `QuestionViewV2` shell (splitter logic untouched),
      `components/query-builder/` (SqlEditor chrome — Monaco untouched — SemanticExplorer,
      QueryModeSelector, pickers, toolbar), `VizTypeSelector` + the whole config-panel long tail
      (VizConfigPanel, AxisBuilder/AxisComponents, pivot/geo/trend builders, FormulaBuilder,
      conditional formats, color pickers, annotations), the Vega panels
      (VegaVizPanel/EncodingPanel/FieldPopover/SpecInspector/ChartDownloadMenu + VegaChart
      chrome), the flat-table stack (TableV2/Body/HeaderCell/BottomBar, DrillDownCard,
      ChartError, VizTableView), param widgets (Source/InlineSql dropdowns, SourceConfigPopover;
      `getTypeColor` now returns concrete hexes — red-first fix for invalid-CSS token
      interpolation), notebook (View + Sql/Text cells + CellHeader + CellInsertZone), Report/
      Alert views + their four containers (incl. run outputs), CodeView, empty-states, the
      lexical text-block tree (MetricNode/MentionNode render in captured documents; floating
      menus portal with `data-mx-theme-host`), and the shared widgets in rendered trees
      (DatePicker, TabSwitcher, FileSearchSelect, DeliveryPicker, RunNowHeader, SchedulePicker,
      StatusBanner). All of it is under the ESLint `@chakra-ui` ban (directory globs — new files
      are born banned). Kept-Chakra remainder is exactly the §8.3 scope boundary: app shell,
      chat/explore, file browser, admin/connection forms, settings, modals, plus the app-global
      `toaster` service (imperative API used by NotebookTextCell's error path — no DOM in the
      embed tree). `TransformationView` from §8.2 does not exist in the tree (stale doc
      reference).
- [x] Notebook checkpoint held: `NotebookSqlCell` needed only its own chrome — all shared parts
      arrived converted.

### Phase 6 — Deletions + guards (SPLIT by prerequisite — review finding) — ✅ DONE (6c resolved with corrected premise)

**6a — unlocked by Phase 3 (does NOT wait for Phase 5; Phase 3 includes `PivotTable` for exactly
this reason — see its checkbox):**
- [x] Shrink `mirrorAppStyles` — DONE and RE-MEASURED: the mirror now carries only
      `APP_STYLES_BASE_CSS` + the document's `@font-face` rules (pure `collectFontFaceCss`,
      red-first). Measured on the seeded story: **455KB → 22.8KB** mirrored per iframe (the
      195KB emotion runtime block and the 237KB app bundle copy are gone); the story's own
      compiled sheet (~68KB with the full recipe union) is now the embeds' ONLY style source.
      Three staleness gaps this exposed, all fixed red-first:
      (1) previously-saved stories carry compiledCss from an older recipe union → a new
          `storyLoader` recompiles STALE sheets at read time, keyed by `storyCssCompileVersion()`
          (a hash of the recipe union + theme css — self-maintaining, no manual bumps; no
          write-on-read, the next save persists);
      (2) LEGACY marked stories compiled without the recipe union/token layer → every compiled
          story now uses TW_INPUT_JSX + the union (banned-candidate guard still jsx-only);
      (3) the stock shadcn `--chart-1..5` in the story neutral bodies recolored legacy-story
          embeds orange → app palette substituted (same visual bar as the app host blocks),
          browser-verified teal restored.
      The `chakra-theme` capture stamps are DELETED from all three serializers (story, element,
      surface) — the COLOR-MODE class stays (`.dark [data-mx-theme-host]` needs the ancestor);
      the chakravars matrix fixtures are replaced by mode-stamp fixtures (light AND dark token
      resolution, element + story paths, 3 engines — all pass).
- [x] ESLint ban extension — DONE in Phase 5 (directory globs over the full migrated tree; new
      files in those directories are born banned).

**6b — unlocked by Phase 4:**
- [x] Capture-matrix dashboard-surface fixtures — DONE in Phase 4 (the `b2-*` suite). QA flow for
      a themed dashboard — DONE (`test/qa/dashboard-theme.spec.ts`): click-driven create/add/save,
      `content.theme` set via the files API (no click path exists for it by design), then the
      RENDERER verified — `data-theme` stamped, theme `--chart-1` departs from the app palette,
      region inside the live-svg surface. Runs in PR CI (qa.yml).
- [x] CLAUDE.md sweep — DONE: "Rendered-document surfaces & styling" section documents one kit,
      one chart engine (no toggle), the B2 surface + serializers + theme hosts, dashboard
      `content.theme`, tile windowing × capture, and the capture-matrix guarantee.

**6c — unlocked by Phase 5:**
- [x] RESOLVED with a corrected premise: "question config panels are their last users" was
      wrong — 50+ KEPT-Chakra surfaces (chat/explore, file browser, admin forms, settings) still
      import `components/ui/*`, and those keep Chakra by the §8.3 scope boundary, so deleting
      the wrappers would break in-scope-to-keep code. What the checkbox was FOR is enforced
      instead: the migrated trees have ZERO `components/ui/*` Chakra-wrapper imports, locked by
      a second ESLint restricted-imports pattern (tooltip/checkbox/select/close-button/
      color-mode/resizable-panel/ImageLightbox banned in every migrated path; the Chakra-free
      `ui/Link` and the imperative app-shell `ui/toaster` service remain allowed). The wrappers
      themselves get deleted when the app shell exits Chakra — outside this plan's scope.

### Phase 7 — Dashboard perf (COMMITTED — review caught this as the one implicitly-deferred track) — ✅ DONE

The sluggishness §1.3 diagnosed is the user's actual complaint, so its levers are phase-level
checkboxes, not a side note. Independent of every other phase; can start any time after Phase 1.

- [x] Tile windowing — DONE (`components/views/dashboard/WindowedTile.tsx`): question tiles
      render as layout ghosts until within 600px of the viewport (IntersectionObserver;
      mount-once, no unmount thrash). Ghosts fill their grid item (`h-full`) so full content
      height — the marker math dependency — is preserved; text blocks stay always-mounted
      (cheap). No-IO environments (jsdom) mount everything, which is why the existing dashboard
      suites pass unchanged.
- [x] WINDOWING × CAPTURE — DONE red-first (`dashboard-windowing.ui.test.tsx`, 4 tests written
      failing against the pre-windowing tree): ghosts stamp `data-mx-busy="true"` ALWAYS (a
      capture can never settle on ghosts — stronger than "while hydrating", and race-free), and
      `waitForFileViewReady` broadcasts `mx-force-mount-tiles` on every poll (re-broadcast covers
      mid-wait view remounts), hydrating every ghost before the settle can complete.
- [x] ResizeObserver consolidation — VERIFIED already at one per tile: the multi-observer
      problem died with the ECharts stack in Phase 2 (`useChartContainer` deleted); post-Phase-5
      the tile subtree has exactly one RO (VegaChart's size-signal observer) plus one per
      dashboard for the surface (SvgPageSurface). Nothing to consolidate.
- [x] Vega spec/data memoization — DONE red-first (`viz-envelope-memo.ui.test.tsx`):
      `QuestionVisualization`'s legacy bridge envelope is `useMemo`ized, so legitimate
      re-renders (loading flips, new callbacks — which get past the memo comparator by design)
      no longer mint a new envelope identity and force a full Vega view
      finalize/re-parse/re-render. Data-only updates were already rebuild-free in VegaChart.
- [x] Measurements (6-tile, 4,242px-tall tutorial dashboard, dev build):
      **windowed initial mount = 2/6 tiles** (viewport + 600px overscan) — 67% of tile mount
      work (React subtree + query + Vega parse) deferred off the initial paint; below-fold
      ghosts are busy-stamped placeholders. **Scroll hydration**: tiles hydrate within the
      scroll gesture (ghosts 4→2→0 across two wheel scrolls, all 6 Vega charts live, no jank
      observed). Windowing×capture: force-mount path proven per-engine in the matrix.
      IMPLEMENTATION CORRECTION recorded for §5/Phase 7: the original IntersectionObserver
      approach passed every jsdom test and was silently DEAD in real engines — IO callbacks
      never fire for foreignObject descendants (verified: on-screen target, no initial
      observation, Chromium/WebKit/Firefox). Windowing is scroll/resize + gBCR (capture-phase
      document listener, rAF-throttled); the real-browser guard is the matrix `b2-windowed`
      fixture (ghost → scroll-hydrate → force-mount, 3 engines).

---

## 6. Expected performance outcomes (kept honest)

| Change | Expected effect | Confidence |
|---|---|---|
| Tile windowing (Phase 7) | Large-dashboard mount + scroll jank drops roughly with the fraction of tiles off-screen | High — standard technique, tables already prove it in-repo |
| ECharts-path deletion (Phase 2) | Bundle/dep weight and dead-code removal; no runtime change on the default path (already Vega) | High |
| Emotion removal (Phases 3 + 5) | Less style-recalc/injection churn per tile mount; smaller CSSOM; `mirrorAppStyles` deletion removes story-iframe churn | Medium — real but needs before/after measurement |
| Per-tile Vega profiling + observer consolidation | Fewer layout-read storms on resize/drag; memoized spec/data derivation | Medium — measure first |
| Iframe for dashboards | **No rendering speed-up** — do not expect one | High (this is the cmiiw) |
| Markers for dashboards | No perf effect; agent-visibility win only | — |

---

## 7. Executed de-risk results (run 2026-07-22, this machine, real code — not estimates)

### 7.1 V1→Vega bridge: full coverage, headless, fast
Every `VizSettings.type` rendered through the PRODUCTION path (`vizSettingsToEnvelopeStatic` →
`renderEnvelopeToSvg`, Vega `renderer:'none'` → `toSVG()`), with mark-count assertions:

```
bar 36ms · line 20ms · area 14ms · scatter 11ms · row 9ms · pie 8ms · funnel 9ms
waterfall 11ms · radar 7ms · trend 7ms · combo 20ms · single_value 1ms (text metric — 2 marks is correct)
choropleth 116ms · point_map 33ms · geo 23ms          → 15/15 PASS
5k-point scatter: 52ms, 551 KB SVG, 1,015 marks       → scale is a non-issue
```

Two harness findings worth keeping: geo types bind `lat = xCols[0], lng = xCols[1]` (or
`geoConfig.latCol/lngCol`) — wrong binding order fails loudly, not silently; and choropleth's
topojson assets are fetched by ROOT-RELATIVE URL (`/geojson/…`), which resolves in the browser but
means any fully-headless (no-origin) render needs a base URL or fetch shim.

### 7.2 Option B2: react-grid-layout inside main-document `<svg><foreignObject>` — PASSES
Real RGL (the dashboard's actual grid library, `WidthProvider(GridLayout)`, 4 tiles), three
engines, real mouse input:

```
                         chromium   webkit   firefox
grid lays out               PASS      PASS      PASS   (WidthProvider measures 940px correctly)
drag commits layout         PASS      PASS      PASS   (tile b: (6,0) → (2,2))
resize commits              PASS      PASS      PASS   (tile a: 6x2 → 8x3)
live-svg capture untainted  PASS      PASS      PASS   (per-tile pixel counts match across engines)
```

The capture check is the story-style pipeline (serialize live `<svg>` + cloned styles →
percent-encoded data: URL → `<img>` → canvas → `getImageData`, which throws on taint). Spike
scripts live in the session scratchpad; Phase 4 promotes them into `capture-matrix.ts` as
permanent fixtures.

### 7.3 What remains genuinely un-de-risked
1. **Visual grading** of bridge output vs the ECharts look across the seeded dashboards (coverage
   proven; taste is a judged sweep, Phase 2).
2. **Popovers/menus over the B2 surface during drag**, and the §7.2 re-proof with real
   (post-re-skin) chrome (Phase 4's remaining spike items).
3. **Perf attribution** for Emotion removal and tile windowing — directionally confident,
   measured only when the phases land (the plan requires before/after numbers).

---

## 8. Final outcome confirmations (explicit, per review)

1. **ECharts is fully removed — including compatibility.** The `vizRenderer:'echarts'` toggle and
   its localStorage key, `ChartHost`/`EChart`/`BaseChart`, the per-type plotx Plot components,
   `ChartImageRenderer.client`, and the `echarts` package dependencies all go. No compatibility
   shim remains; old `vizSettings` content keeps rendering forever via the (kept, pure)
   `from-vizsettings` bridge — that bridge is data conversion, not ECharts compatibility.
2. **Every in-scope content view ends Chakra-free**: story (already), dashboard, notebook,
   question, report, alert, the run-output views, plus CodeView/TransformationView (views, not
   FileTypes) — no `@chakra-ui` imports anywhere in their render trees, enforced the same way `RESTRICT_VIEW_REDUX` is (an ESLint import ban on
   those paths, so regressions fail `npm run validate`).
3. **Scope boundary, stated plainly**: admin/form surfaces (connection, context, config, styles,
   users) and the app shell (sidebars, file browser, settings, chat panel) KEEP Chakra. "The app
   is Chakra-free" is NOT an outcome of this plan — "every rendered document is" is.
4. **Markers**: one declared flag in `FILE_TYPE_METADATA` (§2b), so story + dashboard + notebook
   + report + alert + alert_run + report_run get the numbered gutter (context_run pending its
   Phase 1 rendering check) and `<Viewport>` pointer in agent app-state images;
   questions deliberately don't, and admin/form types (`h:'none'` but unflagged) don't either.

---

## 9. Decision log (review round 1 — nothing open)

1. ~~Chart convergence end-state~~ — **DECIDED: Vega everywhere** (already the default; Phase 2
   deletes the rollback path). ~~Coverage/perf risk~~ **de-risked (§7.1)**. ~~Grading process~~ —
   **resolved (review)**: the user grades a capture-matrix-generated side-by-side gallery of the
   seeded dashboards, binary keep/fix per chart type, one afternoon (now a Phase 2 checkbox).
2. ~~Themes on dashboards~~ — **DECIDED (user): per-dashboard `theme` field with fallback to an
   org default.** Storage mirrors stories exactly: an optional `theme` field on
   `DashboardContent` in `lib/validation/atlas-schemas.ts` (the TypeBox single source), typed by
   the SAME `STORY_THEME_NAMES` enum `StoryContent.theme` already uses — so it lives top-level in
   the dashboard file's `content` JSON. Absent/null → the org default (a `configs` document
   setting, resolved at render). One shared enum, one theme registry, zero new concepts.
   Theme × color-mode (review nit, closed): themes are PALETTES with light AND dark variable
   sets; the dashboard surface inherits the APP's color mode as its `.dark` ancestor — exactly
   the contract stories already have when rendered inside the app shell. A themed dashboard is
   a themed region within the shell, in whichever mode the app is in; themes never override the
   user's light/dark choice.
3. ~~Kit ownership~~ — **DECIDED (doc + review agree): one kit, promoted out of
   `lib/story-ui/`**; the interpreter registry just maps names into it. Forking would recreate
   the dual-maintenance problem this plan exists to kill.
4. ~~Question page ambition~~ — **DECIDED (user): Phase 5 is committed scope.** The review's
   deferral proposal was rejected; the final outcome is every in-scope file type fully
   Chakra-free, and the campaign is not done until that includes the question workbench. The
   6a/6b/6c split is kept purely as dependency ordering, not as an escape hatch.
5. ~~B2 core feasibility~~ — **de-risked (§7.2: drag/resize/capture pass on three engines)**.
   The popover-over-surface check and the real-chrome re-proof are Phase 4 checkboxes (§7.3
   item 2), with a clear bar: menus must work normally and stay out of captures.
