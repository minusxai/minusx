# Canvas Rendering Architecture for Stories (and eventually Dashboards)

**Status:** Research / proposal — no code yet
**Scope now:** Stories, **fully on canvas** — the visible viewer, agent
screenshots, crop, and remote rendering all come from one rasterizer. Scoped by
*file type* (all of stories), not by capability (no raster-only half-measure).
**Later:** dashboards, remote rendering of any file.
**Date:** 2026-07-16

---

## 1. Why

Today what the **user** sees and what the **model** sees come from two different
renderers:

- The user sees the real DOM (story HTML + Tailwind inside a same-origin iframe,
  ECharts canvases, TanStack/Chakra tables).
- The model sees a **re-render** of that DOM by snapdom (`@zumer/snapdom`), which
  clones the subtree, inlines styles/fonts, and rasterizes via SVG
  `<foreignObject>`.

That double-rendering causes every pain point we have:

| Pain | Root cause |
|---|---|
| Screenshots are slow (~1s for a 25-widget view) and run on the main thread — `warmFileScreenshot` idle-warming and the `isEditing` skip in `lib/screenshot/app-state-screenshot.ts` exist purely to hide this | snapdom must deep-clone + re-serialize the live DOM synchronously |
| Screenshots are error-prone (half-hydrated captures, the whole `data-mx-busy` readiness handshake in `lib/screenshot/readiness.ts`) | capture races React hydration of iframe embeds |
| Iframe-only fonts break capture (`resolve-story-fonts.ts` hoists `@font-face` to the top document as a workaround for snapdom #441/#309) | snapdom reads the *global* document's fonts, not the iframe's |
| Crop tool mis-captures horizontally-scrolled content (`captureElementFullHeightBlob` temporarily expands scrollables, 100ms settle, restore) | DOM scroll state ≠ content extent; rasterizing a scrolled viewport loses off-screen content |
| No remote rendering of a story (e.g. for Slack, scheduled reports, OG images of the real content) | rendering requires a browser DOM; there is no headless path |
| Model-view ≈ user-view but never == | two independent renderers can only approximate each other |

**The unifying fix:** make the story renderable by a **single deterministic
rasterizer** that runs identically in the browser and on the server, from the
markup alone — no DOM required. Then:

- screenshot = "return the raster" (instant, off-main-thread capable)
- crop = `drawImage` of a sub-rect of the full raster (scroll is not a concept —
  the raster is the full laid-out content)
- remote render = run the same rasterizer on the server
- consistency = there is only one renderer, so agent-view ≡ raster ≡ user-view

This is viable **because stories are already a constrained subset**, not arbitrary
HTML — see §2.

---

## 2. Where we are today (relevant facts from the codebase)

### Story authoring & rendering
- Agents author stories as **static HTML-ish JSX** (`lib/data/story/story-v2.ts`):
  lowercase HTML tags, CSS in `<style>{`…`}</style>` template literals, plus a
  **closed set of Capitalized components**:
  - **Live embeds**: `<Question/>`, `<Param/>`, `<Number/>` — become placeholder
    `div`s, hydrated by a **nested React root inside the iframe**
    (`components/views/shared/StoryEmbeds.tsx`).
  - **Design-system components** (`lib/data/story/story-components.ts`):
    `Section, Grid, Card, Stat, StatValue, StatDelta, Pill, Callout, Quote,
    Headline, PageHeader, Takeaways, FigurePlate`, … — **compile-time only**,
    each expands to a fixed HTML tag + a curated **Tailwind v4** class recipe
    with enum-only props. No runtime React.
- Tailwind CSS is **compiled server-side per story** (`story-css.server.ts`,
  in-process `@tailwindcss/node` `compile`) and injected into the iframe by
  `AgentHtml.tsx` (sanitize → CSP → doc.write → ResizeObserver height).
- So the "design library" the agent uses is: Tailwind utility classes +
  shadcn-style component recipes + free-form `<style>` blocks. Only the last one
  is truly open-ended.

### Screenshots
- All capture is snapdom (`lib/screenshot/capture.ts`), single full-view
  screenshot attached to app state (`app-state-screenshot.ts`), crop via
  `snapdom.toCanvas` + `drawImage` (`captureRegionBlob`). Constants: 512px max,
  2× ratio, JPEG 0.85.

### Charts
- UI today: **ECharts 6** (canvas renderer in prod). Being removed.
- **Viz V2 (vega-lite) already exists in the lib tier** (`lib/viz/render-vega.ts`)
  with exactly the property we need: one pipeline (`vega-lite compile → vega
  parse(ast) → View` with the CSP-safe expression interpreter) and **three
  renderers — `svg` (browser), `canvas` (image export), `none` → `toSVG()`
  (headless)**. Vega's `View.toCanvas()` resolves to an HTML canvas in the
  browser and a node-canvas `Canvas` in Node — **charts are already
  canvas-unifiable with zero new technology**.
- Server chart images: ECharts SSR → SVG → `@resvg/resvg-js` → `sharp`
  (`lib/chart/render-chart.ts`) — replaced by vega canvas once V2 lands.

### Tables
- Question tables: **TanStack Table** (`@tanstack/react-table`) +
  `@tanstack/react-virtual`, DOM-rendered (`components/plotx/TableV2.tsx`),
  column stats via DuckDB-WASM.
- Pivot: Chakra `Table`, not virtualized (`components/plotx/PivotTable.tsx`),
  pure aggregation in `lib/chart/pivot-utils.ts` / `pivot-grid.ts`.
- Important split: TanStack Table is **headless** — all the table math (sorting,
  grouping, sizing, visibility) is renderer-agnostic. Only the painting is DOM.
  Same for pivots: `aggregatePivotData()` is pure.

### Server-side precedents already in-repo
- `next/og` `ImageResponse` (satori under the hood) for OG cards
  (`lib/og/og-cards.tsx`) — including a comment working around a satori
  limitation ("satori can't do CSS blur").
- `@resvg/resvg-js` + `sharp` already shipped and font-provisioned
  (`public/fonts/JetBrainsMono-*.ttf`).
- No puppeteer/playwright in production paths.

**Takeaway:** the agent-authored surface is *almost* a closed, rasterizable
subset already. The open holes are (a) free-form `<style>` blocks, (b) the DOM
table/pivot renderers, (c) responsive/container-query behavior (`@xl:` variants
in component recipes), (d) live interactivity (Param controls, tooltips, links).

---

## 3. Ecosystem survey — ways to get "HTML" onto a canvas

### 3.1 DOM-capture libraries (require a live DOM)
| Library | Approach | Verdict |
|---|---|---|
| **snapdom** (current) | clone DOM → SVG `foreignObject` → raster | Best-in-class *capture* (30–100× faster than html2canvas), but still needs the DOM, still main-thread, still a second renderer approximating the first. Solves none of consistency/remote. Keep only as legacy fallback. |
| html2canvas / html-to-image | reimplement CSS painting in JS / foreignObject | Strictly worse than snapdom for us. |

These can never give remote rendering or true consistency — they are re-renderers
of a DOM that must exist first. **Not the architecture; at best the fallback.**

### 3.2 Headless-browser service (Playwright/Chromium pool)
Pixel-perfect real HTML, but: a heavyweight service to operate, cold-start
latency, *still* a second rendering context (fonts/viewport/scroll can diverge),
and it does nothing for in-browser screenshot speed or crop. It's the industry
default for "render this URL," and the honest cheap alternative if we abandon
the subset idea — but it entrenches double rendering rather than removing it.

### 3.3 HTML-subset layout engines (no DOM; the interesting category)
| Engine | Layout | Tailwind | Runtimes | Output | Notes |
|---|---|---|---|---|---|
| **satori** (vercel) | Yoga — **flexbox only**, no grid, no block flow, no `calc()`, no z-index | experimental `tw` prop (twrnc; no arbitrary values) | JS+WASM everywhere | SVG (raster via resvg) | Already indirectly in-repo via `next/og`. Battle-tested for OG cards; too weak for stories (our component recipes use grid + block flow). |
| **Takumi** (`takumi-rs`) | Rust (taffy): **flex + grid + block + inline + float**, `position:absolute`, `::before/::after`, masks, clip-path, blend modes, conic gradients | `tw` attribute supported | **Native Rust on Node + the same core as WASM in browsers/edge** | PNG/JPEG/WebP/SVG directly (no SVG intermediate), 2–10× faster than satori+resvg | MIT/Apache-2, 2.4k★, very active (1.4k releases), positioned as the "drop-in next/og replacement". Accepts JSX **and HTML strings**. WOFF2 + emoji + RTL. |
| **CanvasKit (Skia WASM) / custom display-list renderer** | build our own (taffy/yoga + our painter) | ours to build | everywhere | canvas draw calls | Maximum control (this is the Flutter/Figma path) — and maximum cost. Only justified if Takumi-class engines prove insufficient. |
| **HTML-in-Canvas API** (`drawElementImage()`) | the real browser engine draws DOM *into* canvas, keeping a11y + hit-testing | n/a | Chrome-only, **origin trial (Chrome 148–150, 2026)**, no GA date | canvas | Watch closely — if it ships cross-browser it dissolves the browser half of this problem (but never the server half). Not a foundation today. |

**Key property of Takumi:** the *same Rust core* runs natively on the server and
as WASM in the browser → **pixel-identical output in both places**, from markup
alone, with Tailwind support and a layout feature set (grid/block/inline) that
covers our story component recipes. Satori cannot represent our components
(grid); Takumi can.

### 3.4 Charts
Vega. Done — `View.toCanvas()` is first-class in browser and Node
(node-canvas / `@napi-rs/canvas`-compatible), and Viz V2 already routes through
one envelope with `svg` / `canvas` / headless renderers. The echarts removal is
a prerequisite, not new work created by this project.

### 3.5 Tables & pivots on canvas
| Option | What it is | Fit |
|---|---|---|
| **Custom canvas painter fed by TanStack/pivot math** (recommended) | Keep `@tanstack/react-table` row/column model and `aggregatePivotData()` as the *math*; write one `paintTable(ctx, model, theme)` / `paintPivot(ctx, PivotData, theme)` in pure Canvas2D (`measureText`, grid lines, heatmap fills, nested headers). Runs on browser canvas, OffscreenCanvas, and node canvas unchanged. | Tables in a *story* are static snapshots (top-N rows, capped height) — a painter is a small, fully-controlled component, and it's the only option that is genuinely isomorphic (browser + server). Virtualization is irrelevant to a raster: you paint the rows that fit, plus a "showing N of M" footer. |
| **Glide Data Grid** | The proven canvas data grid for React (MIT, millions of rows, 60fps) | The right choice **later** for *interactive* canvas tables (dashboards phase / full-canvas story viewer): it already solved hit-testing, selection, a11y-side-DOM, and per-cell custom canvas renderers. But it is a browser React component, not a headless painter — it can't produce the server raster. Its cell-painting code is a good reference for ours. |
| canvas-datagrid / regular-table / Perspective | older or DOM-based or data-viz-suite-shaped | No advantage over the two above for our shape. |

The painter and Glide are complementary, not competing: painter = raster truth
everywhere; Glide = interactivity when we put a live grid on a canvas surface.

---

## 4. Recommended architecture

### 4.1 The core idea: one raster pipeline, three consumers

```
                    story markup (validated canvas-subset JSX)
                                  │
              ┌───────────────────┼─────────────────────┐
              │ embeds            │ static content      │
              ▼                   ▼                     │
   vega View.toCanvas()   Takumi (tw + component        │
   table/pivot painter     recipes → layout → raster)   │
              │                   │                     │
              └──── composite: embeds injected as ──────┘
                    sized <img> nodes in the Takumi tree
                                  │
                        ┌─────────┴─────────┐
                        │  StoryRaster       │   one module, two builds:
                        │  render(markup,    │   • browser (WASM, OffscreenCanvas/worker)
                        │   data, width,     │   • server  (native Rust + node canvas)
                        │   theme) → bitmap  │
                        └─────────┬─────────┘
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   agent screenshot          crop tool              remote render
   (full raster,          (drawImage sub-rect     (Slack, scheduled
   scaled to 512px)        of full raster —        reports, OG, API
                           no scroll concept)      `GET /f/{id}.png`)
```

`StoryRaster.render(markup, queryData, width, colorMode)` is a pure function:
- Parse the story markup (existing `parseStoryJsx`), expand component recipes
  (existing `story-components.ts` expansion — reused verbatim).
- For each embed placeholder, render it to a bitmap at its laid-out width:
  - `<Question/>` chart → Viz V2 `renderEnvelopeToCanvas` (vega)
  - `<Question/>` table / pivot viz → canvas table/pivot painter
  - `<Number/>`, `<Param/>` → painted as styled text spans (Params render their
    *current value*; the control chrome is a DOM-viewer concern)
- Hand Takumi the full tree (Tailwind classes + embeds as data-URL/`<img>` nodes
  with explicit dimensions) → one PNG/bitmap of the entire story at a fixed
  logical width.

Determinism inputs (all explicit): markup, query results, width, color mode,
font buffers (WOFF2, shipped with the app; `resolve-story-fonts.ts` logic reused
to fetch story-declared fonts as buffers). Cache key = the same facet hash
`app-state-screenshot.ts` already computes.

### 4.2 What the user sees — the canvas viewer (committed scope)

The story viewer itself renders on canvas. The DOM/iframe path
(`AgentHtml.tsx` + `StoryEmbeds.tsx` + snapdom) survives only as a
feature-flagged fallback for legacy stories that fail subset validation (§4.4)
— it is not part of the target architecture. "No double rendering" is literal:
the visible canvas, the agent screenshot, the crop source, and the remote
render are the same bitmap pipeline.

The viewer is the raster (§4.1) plus four browser-side layers:

- **Tiled rendering** (non-negotiable for mobile, see §4.6): the story is
  drawn as viewport-height canvas tiles inside a native DOM scroll container —
  scrolling stays browser-composited; tiles rasterize on demand ahead of
  scroll and re-raster at the current `devicePixelRatio` × zoom.
- **Hit-region map**: Takumi's layout pass gives every node a box; export
  `[box, nodeId]` pairs and hit-test clicks/taps in JS (links, embeds,
  editable blocks).
- **DOM overlay islands**: interactive controls (Param inputs, chart
  tooltips/hover) are small absolutely-positioned DOM elements placed from the
  layout map — canvas owns the ~95% static surface, DOM appears only where a
  native input widget is genuinely better.
- **Side-DOM for a11y + text selection + find-in-page** (the Google Docs
  pattern): a hidden semantic DOM built from the same markup — cheap for us
  because we own the canonical source; it's a projection, not a second layout
  engine.
- If/when the **HTML-in-Canvas API** ships cross-browser, it can replace the
  overlay+side-DOM machinery wholesale; track it, don't wait for it.

**Inline editing — the one deliberate hybrid.** Stories today have WYSIWYG
inline text editing (`AgentHtml.tsx` flips text containers to
`contentEditable`). Reimplementing cursor/IME/selection/autocorrect on canvas
is a text-editor project, and even canvas-first apps don't do it: Excalidraw,
Figma, and Glide Data Grid all swap in a real DOM input **overlay** at the
laid-out position when text is edited, then commit and re-raster. We do the
same: tapping an editable block in edit mode overlays a matching
`contentEditable` element (positioned + styled from the layout map); on
commit, the change round-trips through the existing markup serializer and the
affected tiles repaint. Canvas remains the *only display renderer* — the DOM
edit overlay is a transient input widget, exactly like a `<textarea>` in
Figma. A from-scratch canvas text editor is explicitly **out of scope**: it's
the one sub-problem that could sink the timeline while proving nothing about
rendering.

**Later — dashboards:** same raster core; the grid layout is even easier than
stories (fixed grid geometry, every tile is a chart/table embed we can already
paint). Interactive dashboards on canvas would adopt Glide Data Grid for live
tables.

### 4.3 Component inventory to build

| Piece | Build on | Effort |
|---|---|---|
| `StoryRaster` module (parse → expand → compose → Takumi) | `parseStoryJsx`, `story-components.ts`, Takumi (`@takumi-rs/core` native + `takumi-js`/WASM helpers) | the core new work |
| Chart-to-bitmap | Viz V2 `render-vega.ts` (`canvas` renderer, node-canvas server-side) | mostly wiring; blocked on echarts→vega cutover for parity |
| Table painter | TanStack table model + Canvas2D | small, well-bounded |
| Pivot painter | `pivot-utils.ts` `PivotData` + Canvas2D (nested headers, subtotals, heatmap from `PivotTableHeatmap.ts` logic) | medium — pivots have the most visual structure |
| Subset validator + linter (§4.4) | existing markup validation in `file-markup.ts` | small |
| Crop tool rewrite | `cropSourceRect` math (already pure) over the raster instead of snapdom | small; deletes the scroll-expansion hacks |
| Remote render endpoint | `StoryRaster` on server + existing object store / sharp | small |
| Canvas viewer: tile manager (scroll container, DPR/zoom re-raster, dirty-tile invalidation) | `StoryRaster` in a worker + `OffscreenCanvas` | medium — the heart of the viewer |
| Hit-region map + overlay islands (links, Param controls, tooltips) | Takumi layout boxes | medium |
| Side-DOM (a11y, text selection, find-in-page) | projection of the same markup | medium |
| Inline-edit DOM overlay (contentEditable island, commit → serializer → repaint) | existing WYSIWYG serializer, layout map | medium |

Explicitly **deleted or demoted** when this lands: snapdom capture path for
stories (kept behind a flag for non-subset legacy stories), `data-mx-busy`
readiness polling, font-hoisting workaround, full-height scroll-expansion
capture, the iframe + nested-React-root viewer (`AgentHtml` + `StoryEmbeds`,
retained only for the legacy fallback).

### 4.4 The subset ("Canvas-Safe Story Markup")

Stories are already 90% closed. To be raster-safe a story must satisfy:
1. **Tags/components**: the existing allowed set (validator already enforces).
2. **Styling**: Tailwind classes + component recipes only, restricted to a
   whitelist of properties Takumi supports (flex/grid/block, spacing, borders,
   radius, shadows, gradients, transforms-2D, masks). **Free-form `<style>`
   blocks are the one open hole**: lint them against the property whitelist;
   long-term, steer the agent away from `<style>` entirely (the component
   recipes + `tw` cover the design language, and the skill prompt already
   pushes that direction).
3. **Container queries resolve at raster time**: recipes use `@xl:` variants
   for responsiveness. Each raster renders at a *fixed logical width*, so
   resolve container-query variants at expansion time for that width; the
   viewer re-rasters on resize/rotation (canvas re-render at a new width is
   cheap and tile-scoped).
4. **Embeds are opaque boxes** with deterministic sizing rules (AgentHtml
   already caps embed widths — codify those rules so DOM and raster size embeds
   identically).

Validation verdict is stored per story (`canvasSafe: true/false`). Non-safe
stories (legacy, or agent used unsupported CSS) fall back to the snapdom path
and are surfaced for migration. New story creation *requires* the subset —
which also improves agent output quality (a smaller, well-defined target).

### 4.5 Why Takumi over the alternatives (decision record)

- **vs satori**: satori is flex-only; our design system uses grid and block
  flow. Satori's Tailwind is a twrnc workaround without arbitrary values.
  Takumi is the same category, strictly larger CSS surface, direct rasterize,
  faster, and dual-runtime with one core. (We already live with satori's limits
  in OG cards — comments in `og-image.tsx` literally document them.)
- **vs building on CanvasKit/taffy ourselves**: that's what Takumi *is*, with
  three years of someone else's text-shaping/emoji/font pain already paid.
  Re-evaluate only if we hit hard limits (its layout core, taffy, is the same
  one we'd pick).
- **Risk to hold**: Takumi is young (2.4k★, essentially one lead maintainer).
  Mitigations: (a) it's MIT/Apache Rust we can fork; (b) our subset is small
  and covered by golden-image tests, so an engine swap (satori-successor,
  future HTML-in-Canvas server-side equivalent, or our own painter) is
  contained behind the `StoryRaster` interface; (c) the raster core is built
  first in the sequence (§6), so an engine problem surfaces in week one, not
  month three.

---

### 4.6 Performance, especially mobile

Two immediate wins regardless of viewer design: raster work moves off the
interaction path (Web Worker + `OffscreenCanvas`, or the server), and
snapdom's ~1s synchronous main-thread rasterization on send disappears. The
WASM bundle (order of a few hundred KB–low MB) is lazy-loaded with the story
viewer.

**The visible canvas viewer is where mobile discipline is
required.** Canvas itself is not the risk — Google Docs, Figma, and Glide Data
Grid all ship canvas UIs that hit 60fps on mobile web — but a *naive* design
fails. The three rules:

1. **Never one giant canvas.** A full story at mobile DPR 3× can exceed
   per-canvas pixel limits (iOS Safari historically ~16M pixels / max
   dimension caps) and GPU memory. Render **tiles** (viewport-height chunks)
   inside a normal DOM scroll container: native scrolling stays
   browser-composited (smooth, no JS per frame), and tiles rasterize on demand
   ahead of the scroll position. This is exactly the Docs/Glide pattern.
2. **Render at `devicePixelRatio`, re-render on zoom.** Canvas text drawn at
   the correct DPR is crisp on retina; pinch-zoom must trigger a re-raster at
   the new scale or text blurs (a scaled bitmap is the tell-tale of a bad
   canvas app). Static story content re-rasters fast enough (target ≪100ms per
   tile) that this is fine, but it must be designed in, not bolted on.
3. **Redraw only dirty tiles.** Stories are mostly static — after initial
   paint, a param change or new query result invalidates specific embed tiles,
   not the page. Static content on canvas is *cheaper* than DOM on mobile (no
   style/layout recalc, far fewer nodes, less memory than a deep DOM tree);
   long stories with many embeds should scroll *better* than today's
   iframe + nested-React-root setup.

Battery/heat: a tiled, dirty-rect canvas draws almost nothing per frame during
scroll (the compositor moves already-painted tiles), so steady-state cost is
comparable to or below DOM. Continuous-redraw designs are what kill batteries;
we don't need one.

Milestone 1 (§6) must include a mid-range Android device and an iPhone over
Safari: measure tile raster time, scroll jank, pinch-zoom re-raster latency,
and WASM load time on a throttled connection.

## 4.7 Validation results (2026-07-16, empirical)

The riskiest assumptions were validated with a working harness (scratchpad
`canvas-validation/`; ~200 lines: real story-component class recipes →
Tailwind v4 CLI compile → `@layer`-flattened CSS → Takumi HTML-string render,
with a headless vega-lite chart and a Canvas2D-painted pivot-style table
injected as `<img>` embeds). Machine: M-series Mac; mobile ≈ 3–5× slower.

| Risk | Result | Numbers |
|---|---|---|
| R1 — renders our story subset | ✅ **Validated.** Grid of stat cards, rounded borders/shadows, tone recipes (pill/callout/delta), CSS-var accent (`--st-accent`), arbitrary values (`tracking-[0.14em]`), serif/italic, flex header/footer — all correct on visual inspection | typical story = 800×1643px raster |
| R2 — stylesheet handling | ✅ **Validated.** `stylesheets: string[]` option + `<style>` tags + `tw` attr + inline styles all work with class selectors. One prerequisite: Tailwind v4's `@layer` wrappers must be flattened — and `story-css.server.ts` **already has** `flattenCssLayers()` in production; reused verbatim | compiled+flattened story CSS ≈ 14KB |
| R3 — native render speed | ✅ **Validated.** vs snapdom's ~1s | cold 41ms, **warm 19ms**, @2x 48ms, JPEG-85 out |
| R4 — WASM speed + size (mobile proxy) | ✅ **Validated.** Even ×5 mobile penalty ⇒ ~140ms/story | init 10ms, cold 105ms, **warm 28ms**; bundle **3.8MB raw / 1.5MB gzipped** (lazy-load) |
| R5 — fonts + wrapping fidelity | ✅ **Validated** (same WOFF2/TTF registered both sides). Chrome body height 1630px vs Takumi 1643px = **0.8% divergence**; wrapping matches at real widths. ⚠️ One divergence found: `ch` units (`max-w-[62ch]`) resolve differently — add to subset lint | |
| R6 — embed compositing | ✅ **Validated.** vega-lite headless (`renderer:'none'` → SVG → resvg, no node-canvas needed) + Canvas2D table painter, injected via `images:[{src,data}]`, laid out correctly | chart 35ms, table paint 18ms |
| R7 — crop correctness | ✅ **Validated.** Crop = `extract` sub-rect of the raster; trivially WYSIWYG since it's the same bitmap | 3ms |
| R8 — long-story limits | ✅ **Validated.** Auto-height works (`width` only); 20-section story renders in one pass | 800×26,951px in **316ms** native / 453ms WASM, 2.2MB PNG |

API facts learned (for the implementation):
- `render(htmlString, { width, stylesheets, images, format, quality })` —
  HTML-string input is first-class; height auto-computed from content
  (**scroll is not a concept** — the full-content raster falls out for free).
- `devicePixelRatio` treats `width` as *device* pixels (pass `width: 1600,
  dpr: 2` for an 800-CSS-px @2x raster).
- Fonts: `renderer.registerFont(buffer)` (TTF/WOFF2); pin exact files, disable
  system fallback, register the same buffers the viewer's `@font-face` uses.
- Tile rendering for the viewer = render full raster once and blit sub-rects,
  or re-render at heights per tile; at 19–28ms/story either is viable.

**Round 2 (same day) — viewer-critical checks, all in real Chrome:**

| Check | Result |
|---|---|
| WASM in a real browser (main thread) | ✅ wasm fetch+compile+init **18ms**, cold render 241ms, **warm 83ms median** (53ms min), identical 800×1643 output. Story markup → WASM → visible `<canvas>` blit (decode+draw **6.6ms**) — i.e. the viewer pipeline itself, prototyped end-to-end. Desktop-Chrome 83ms ⇒ ~250–400ms/full story on a mid-range phone; tiles are fractions of a story, so well within budget. |
| Hit-testing / overlay geometry | ✅ `renderer.measure(node, opts)` returns the full layout tree: per-node `width/height/transform` **plus per-text-run `{text, x, y, width}`** — inline link hit-regions, overlay-island placement, and even text-selection geometry come from the engine directly. No custom layout-metadata work needed. |
| Emoji / CJK / RTL | ◑ Emoji ✅ (twemoji pipeline). CJK + Arabic show tofu **unless a font with those scripts is registered** — an expected font-provisioning task (register Noto subsets or lazy-load per detected script via `loadAdditionalAsset`-style hooks), not an engine gap. |

**Round 3 — text selection on canvas, working prototype** (`out/browser-select.html`
in the harness): drag-to-select drawn as highlight rects over the bitmap,
character-approximate offsets within runs, multi-line ranges that flow around
inline elements (pills), exact text extraction, cmd/ctrl+C to clipboard — all
driven purely by `measure()` geometry, no DOM. Render + measure together:
~118ms in-browser WASM. Two engine findings the implementation must encode:
- `measure()` emits text runs **only for inline children**, not a block's own
  bare text — fix is a lossless node-tree transform (wrap bare text in a
  nested text child; ~5 lines) applied before measuring.
- `MeasuredNode.transform` translations are **root-absolute**, not
  parent-relative — do not accumulate while walking.

### Story interactions on canvas — the inventory (all in scope, milestone 4)

Stories need their interactions (this is committed scope, not optional).
Each maps to one of two mechanisms the prototypes just validated:

| Interaction | Mechanism |
|---|---|
| Text selection / copy | **Canvas-drawn** from `measure()` run geometry — prototyped, works |
| Link hover/click | Hit-region from `measure()` boxes (`cursor:pointer`, navigate on click) |
| `<Number/>` click → popup | Hit-region on the embed box → **DOM overlay island**: the existing popover component absolutely positioned at the box — the popover itself stays DOM (it's transient chrome, like the edit overlay) |
| `<Param/>` controls | DOM overlay island at the embed box (native inputs beat canvas-drawn inputs) |
| Chart (vega) hover/tooltips | The embed box swaps from bitmap to a **live vega view** on pointer-enter — vega renders to canvas itself, and its own scenegraph handles hover/tooltip; on pointer-leave it can revert to the cached bitmap. Cheap because vega canvas mount ≈ the same 30ms class as our raster |
| Table sort / scroll / cell hover | Same swap pattern: static painted bitmap at rest; on interaction the box goes live (canvas grid à la Glide, or the interim DOM table as an island). Rest state = raster, so screenshots stay WYSIWYG |

The unifying rule: **the resting story is one bitmap** (what the agent
screenshots); interaction *transiently activates* the region under the
pointer as a live island (canvas-native like vega, or DOM chrome like
popovers/inputs), then returns to the raster. Screenshots capture resting
state — identical to what a non-interacting user sees.

**Round 4 — full interactivity matrix, working prototype**
(`out/browser-interactive.html` in the harness, driven end-to-end in real
Chrome). Every interaction class from the inventory above now has a running
implementation against the WASM-rendered story canvas:

| Interaction | Validated behavior |
|---|---|
| Number click → popover | ✅ **Canvas-drawn** popover (rounded rect + text painted on the story canvas — no DOM at all); survives re-renders because it's part of `draw()` |
| Param → component change | ✅ Input change → node-tree mutation → **full story re-render in 39ms** → stat updates in place (2.9% → 4.5%) |
| Chart hover → live vega | ✅ Pointer-enter mounts a live vega canvas view **in 29ms**; tooltips fire with real data (`{month, segment, revenue}`); pointer-leave reverts to bitmap |
| Table hover → live island | ✅ Sortable table island mounts on hover; header click sorts (asc/desc + indicator); leave reverts to bitmap |
| Text selection / copy | ✅ (round 3) canvas-drawn highlights + clipboard |
| Hit-region cursors | ✅ text/pointer/crosshair cursors by region from `measure()` boxes |

**Canvas-only vs DOM islands — resolved by experiment.** Read-only chrome
(popovers, tooltips, selection highlights) can be *fully canvas-drawn* — the
popover prototype proves it and it composes cleanly with re-renders. DOM
overlay islands remain the right tool for exactly two things: **native text
input** (IME/focus/autocorrect — the param `<input>` and the edit overlay)
and **live embeds** that already render to their own canvas (vega). So "the
story is canvas" holds: DOM appears only as transient input widgets, never as
display surface.

Additional engine findings for the implementation:
- The measured tree prunes whitespace-only text children, so index-pairing
  it against a `fromHtml` node tree is unreliable — the production
  `StoryRaster` should build node trees directly (not via `fromHtml`) and
  carry its own node-id ↔ box mapping; embed boxes can also be matched by
  known dimensions.
- Vega's canvas hit-testing reads `event.offsetX`, which synthetic
  `MouseEvent`s can't carry — only affects test tooling (real pointers are
  fine); QA flows should use real cursor moves, not dispatched events.

**Round 5 — full representative story, end-to-end**
(`out/full-story.html` + `out/story2.mjs` in the harness). A complete
parameterized story — 2 params (segment, window), 2 vega questions (line +
bar), a canvas-painted heatmap table, 3 stat cards, an inline number — with
the whole pipeline running in-browser and **zero DOM in the story surface**:

```
param click (canvas chip) → derive(params) → vega toCanvas → PNG
  + table painter (OffscreenCanvas) → PNG
  → Takumi WASM raster (auto-height) → measure() → geometry → draw
```

| Measured | Result |
|---|---|
| Cold boot (wasm + fonts + first full render) | ~220–290ms |
| Param change → full story re-render (warm) | **120ms** (embeds 81ms + raster 39ms) |
| Param chips | canvas-drawn, selected-state restyle via markup class swap, click = hit-region |
| Stats / inline numbers | recompute from params; click → canvas popover showing live param lineage |
| Charts | rest = bitmap; hover = live vega island with real tooltips |
| Table | canvas-painted incl. heatmap + sort indicators; header click re-sorts and re-renders the story (no sideways scrolling, ever) |
| Authoring format | **unchanged** — the same class-based markup + Tailwind recipes as production stories; only the projection differs |

Two more engine findings: HTML entities (`&nbsp;`) are not decoded by
`fromHtml` (pre-decode entities in the codec); and embed regeneration
dominates re-render cost when vega recompiles cold (~1s worst case) — the
implementation should dirty-track embeds and only re-render those whose
inputs changed (the story raster itself is consistently ~40–70ms warm).

### Why any DOM at all? (resolved)

After rounds 3–5 the answer is precise. The story surface needs **zero DOM**
— text, selection, popovers, params, tables, sort, tooltips-chrome can all be
canvas. What remains DOM is only infrastructure, each for a hard reason:

1. **The page shell** — a `<canvas>` needs a document to live in, and the
   scroll container gives us browser-composited scrolling (Figma reimplements
   scrolling from scratch; native scroll is free, smoother on mobile, and
   preserves momentum/overscroll physics).
2. **The a11y side-DOM** — screen readers, find-in-page, and browser features
   consume the DOM tree; a hidden semantic projection is how Google Docs
   solves this on canvas. Not visible, not a renderer.
3. **Text input** — IME composition, autocorrect, mobile keyboards, and
   focus semantics live in the browser's input stack (the edit overlay and
   any free-text param). Every canvas-first product (Figma, Docs,
   Excalidraw) uses hidden/overlay DOM inputs.
4. **Live vega views** — vega renders to its own canvas; mounting it as an
   island IS canvas rendering, just vega's canvas instead of ours.

Nothing on that list is a *display* path for story content. The double-
rendering problem this doc exists to solve is fully eliminated.

**Round 6 — A/B renderer parity harness (the decisive test).**
One shared story definition (`out/rep-story.mjs`: params, 3 stat cards,
inline number, two vega charts side by side, a 192-row vertically-scrolling
table, a 12-month-column horizontally-scrolling pivot, callout, quote) served
at two URLs and driven side-by-side in two Chrome tabs:
- **A — DOM reference** (`out/dom-story.html`): real DOM + live vega views +
  native-scroll tables — how production renders today.
- **B — Canvas** (`out/canvas-story.html`): Takumi WASM raster at DPR 2 +
  compositor (tables painted per-frame into the story canvas, virtualized —
  only visible rows painted) + document-order selection with glyph-measured
  character offsets + same-view chart islands.

| Dimension | Verdict |
|---|---|
| Layout | ✅ landmark drift ≤ **±6px over 1913px (0.3%)**; total height 1913 vs 1904 |
| Fonts | ✅ same Inter/JetBrains Mono files registered in both; rendering visually indistinguishable |
| Text selection | ✅ same drag range → same extracted text; long selections across headline→chips→cards→paragraph highlight in document order like native, with partial-run boundaries |
| Chart hover | ✅ tooltip parity **exact** (same point → same `{month, segment, revenue}` on both); island swap invisible (same renderer, same DPR) |
| Params | ✅ chip click → identical re-rendered state (title, chips, stats, inline number, charts, tables); DOM 30ms vs canvas 160ms |
| Table scrolling | ✅ vertical + horizontal inner scrolling with painted scrollbars + frozen label column + sticky header; virtualization = paint-visible-rows |
| Inline numbers | ✅ click → canvas popover with param lineage |
| Perf | canvas boot ~400–600ms (wasm+charts+raster), param rebuild 160ms, scroll repaint per-frame (composited region only) |

Known remaining deltas (all bounded, none architectural):
1. **Line-wrap points** differ by ~a word in some lines (text-measurement
   delta between engines) — content and layout structure identical; would only
   reach zero by using one shaper for both, i.e. after full cutover it's moot
   (canvas becomes the only renderer).
2. **Scrollbar chrome**: canvas paints persistent thumbs; macOS DOM shows
   overlay bars only while scrolling — match by fading thumbs in/out.
3. **Selection joiner polish**: canvas emits `\n` at soft-wrap points and a
   doubled space at inline-span boundaries — fix with block-aware joining
   (runs already carry block identity via the tree).
4. Test-tooling only: CDP synthetic scroll gestures bypass DOM wheel handlers
   (real wheel/trackpad events route correctly — verified by direct event
   dispatch); vega hit-testing needs real pointer events.

**Round-6 net judgment: the two renderers are functionally indistinguishable
for the full representative story, including every interaction class.** The
prior round's failures (hover pop, broken long selection) are confirmed
fixed by design (same-renderer/same-DPR islands; document-order selection).

**Round 7 — selection polish after hands-on user testing.** User testing
found selection highlights misaligned on chips and the closing quote
("clipped off"). Root cause (engine finding, important for `StoryRaster`):
**Takumi reports text-run x/y relative to the node's *content box*, while
node transforms locate the *border box*** — any run-bearing node with its own
padding (chip `px-3`, blockquote `py-6`) draws its highlight shifted by
exactly that padding. Fix: parallel-walk the source node tree (whose
classes/styles we author, so padding is knowable — `className` on `fromHtml`
nodes) against the measured tree (whitespace-only text children are pruned
from it; filter before pairing) and add each node's padding to its run
coordinates. Also fixed: block-aware selection joining (no more stray
newlines/double spaces). Verified after fix: full-document drag
(headline→chips→cards→paragraph→…→quote) highlights precisely on every run,
and the closing quote selects and extracts completely. Upstream candidate:
takumi should expose content-box offsets (or padding) on `MeasuredNode`.

**Round 7 confirmations (user questions):**
- **Same JSX?** Yes — verified byte-identical: the two renderers' markup is
  the same 5,223-character string modulo only the 4 embed expansions
  (chart/table placeholders vs live slots), which mirrors exactly how
  production expands `<Question/>` per surface.
- **Same fonts?** Yes — the same Inter variable + JetBrains Mono files are
  registered in both renderers; zoomed glyph comparison shows identical
  letterforms/weights/slant. Only wrap points occasionally differ (the known
  measurement delta).
- **Params representative?** The chip params exercise the full pipeline shape
  (param change → data recompute → embed re-render → raster, 90–160ms) but
  production params are text/number/date values that rewrite SQL and
  **re-execute the query server-side** — that round-trip is renderer-agnostic
  and dominates latency identically in both. Two items the real
  implementation adds: free-text/number param *input controls* (DOM input
  overlay islands — typing needs IME; enum-like params can stay canvas
  chips), and loading states while queries run (paintable skeletons in the
  embed box).

**Round 8 — input params, crop+annotate, virtualization proof.**

*Input params (text + number) in both renderers.* The shared story gained two
real input params (`min $k/wk` number filter, `segment contains` text filter)
that re-derive data and re-render the weekly table — markup byte-identical in
both modes; A hydrates native inputs into the slots, B overlays persistent
DOM input islands positioned from measured boxes (the designed hybrid).
Typed the same values into both: **identical result** ("WEEKLY DETAIL - 12
ROWS"); A re-renders in 21–48ms, B in ~105ms. This is the production param
shape (value → re-derive → re-render); in production the re-derive step is a
server SQL re-execution, identical for both renderers.

*Crop + brush annotate in both renderers* (shared `crop-annotate.mjs`; drag a
region, then draw on the crop):
- **Canvas: 0ms capture** — sub-rect of its own bitmap, includes composited
  tables/charts, annotate panel instant.
- **DOM: 6,458ms capture with the main thread frozen** — snapdom had to
  re-serialize a story containing live vega canvases and data tables. This is
  the production screenshot pain measured head-to-head on identical content:
  **~6,500× slower**, and it hard-froze the page while running.

*Virtualization proof.* Stress-loaded the canvas weekly table and measured
per-frame painting: **9 rows painted per frame at 384, 5k, 50k, and 500k
total rows; frame cost flat at 0.1–0.6ms.** Paint cost is O(visible rows),
never O(data) — same asymptotics as DOM virtualization (TanStack virtual)
with none of the DOM-node churn.

*Scroll chaining (round 8 fix from user testing):* wheel events over an
inner-scroll region must be consumed **only when the region can actually
scroll further in that direction** — otherwise chain to the page, exactly
like native overflow containers. (Symptom: an emptied/filtered table trapped
page scrolling.) Verified: empty table chains, at-top chains upward, consumes
downward. Corollary (round 8b): a **horizontal-only** scroller must pan only
on real horizontal deltas or shift+wheel — a plain vertical wheel chains to
the page (verified: vertical passes, horizontal and shift+wheel pan). These
rules belong in the viewer's wheel router.

*Round 8 polish from continued user testing:* brush **undo** in the crop
annotator (per-stroke `getImageData` snapshots, button + cmd/ctrl+Z) and
**double-click word selection** (expand to word boundaries around the clicked
character via the same run geometry) — both verified live. Selection-fidelity
checklist for the production viewer so far: drag ranges, partial-run
boundaries, document order, word dblclick; still to add: triple-click
block select, shift-click extend, selectstart on drag out of viewport
(auto-scroll).

### Rollout: the renderer toggle (user-confirmed plan)

Because both renderers consume the same story definition, the cutover is a
**config-stored renderer setting** (configs doc → `renderer: 'dom' |
'canvas'`, per company / per file type, with per-story `canvasSafe` still
gating eligibility). Scope now: **stories only** — finish testing, add the
toggle, merge, deploy; canvas becomes opt-in, then default when confident.
Other file types come much later, but inherit everything: the embed painters
(vega charts, table/pivot), param controls (canvas chips + input islands),
hit-region/selection machinery, and the raster core are file-type-agnostic —
a question page is one big embed; a dashboard is a grid of embeds with
params. The toggle pattern extends per file type in the same order:
stories → params/questions → dashboards.

**Residual risks (deliberately deferred into implementation — not testable
meaningfully outside it):** real mobile device timings (desktop-Chrome WASM
is now the proxy; put a hosted test page on an iPhone + mid-range Android in
milestone 1); full-corpus Tailwind/CSS coverage (run the whitelist linter
across production stories — needs prod story data, not synthetic markup);
worker/OffscreenCanvas plumbing (mechanical); further font-relative-unit
divergences of the `ch` kind (golden tests will surface them); CJK/Arabic
font subset strategy.

## 4.8 Production hardening rounds (2026-07-17)

**Round 10 — snapdom-free captures.** With the canvas renderer ON, screenshots and crops
never run snapdom: embed islands are rasterized to ImageBitmaps at idle (sequential,
settle-timer-driven — never mutation observers, which feed back on animating charts), and a
window-registered provider (`capture-registry.ts`) exposes `drawRegion()`, which composites
any story region straight from the source bitmaps into the caller's context. No full-story
intermediate canvas exists on any path. Measured: full app-state capture ~1.0–1.4s
(was 6.5s + main-thread freezes), crop-to-annotator ~1–2s, `drawRegion` itself ~0.1ms.

**Round 11 — selection-boundary correctness (root cause: `text-wrap: balance`).**
Story headings use `[text-wrap:balance]`. takumi's *render* honors it but *measure()*
always wraps greedily — so the PNG wrapped one word earlier than the run geometry claimed,
and selection bands covered the wrong words (the "skipped fragment" bug). Fix:
`neutralizeBalancedTextWrap()` rewrites `text-wrap: balance|pretty → initial` in every
stylesheet fed to the engine, so pixels and geometry agree by construction. Tradeoff:
canvas headings wrap greedily where the DOM balances them (a wrap-distribution difference
on multi-line headings only). Also fixed: `<title>`/`<script>`/`<style>` nodes are dropped
from the node tree (a `<title>` emitted a phantom run of the whole heading that hijacked
hit-testing).

**Round 12 — deep-module refactor + perf/memory.** `lib/canvas-story/` now owns the whole
feature behind four deep hooks — `useStoryRaster` (measure-gated single first raster at the
real container width; no nominal-width flash), `useCanvasSelection` (pure selection model in
`selection.ts`, unit-tested; translucent teal wash replaces the white-glyph second raster —
which both fixed the white-on-white selection bug and halved raster work + bitmap memory),
`useEmbedIslands`, `useStoryCapture`. `CanvasStoryView` is a ~120-line composition.
ImageBitmaps are `close()`d on replacement and unmount (story raster + island caches);
all observers/timers/listeners/providers unregister on unmount.

**Round 13 — DOM-exact root padding (`@container` ancestor semantics).** A `@container`
query matches an element's ANCESTOR container, so a variant class on the container
element itself (the story root's own `@2xl:px-12`) never applies in the DOM. The static
resolver now scopes every unwrapped rule to `.\@container` descendants — handling both
emission forms: classic (`@container{.sel{…}}`) and Tailwind v4 nested
(`.sel{@container{…}}`, the form real compiledCss documents use). Canvas root padding
now matches the DOM exactly. Remaining known visual delta vs the DOM: balanced heading
wrap (neutralized for geometry correctness, round 11) and sub-word font-metric drift on
@import'd serif faces.

## 5. Risks & open questions

1. **Raster quality vs today's DOM view.** With canvas as the viewer there is
   no DOM↔raster gap by definition — but the raster must *look as good as* the
   current DOM view or users will notice the migration. First empirical check
   (§4.7): 0.8% height divergence vs Chrome on a representative story, visual
   match on inspection. Golden-image comparisons across a real story corpus
   (milestone 1) remain the quality bar.
2. **Text**: shaping, wrapping, kerning differences; font fallback chains must
   be pinned (ship exact WOFF2s; no system-font fallback in the raster).
   §4.7 found one concrete unit divergence (`ch` in `max-w-[62ch]`) — the
   subset linter must flag `ch`/`ex`-style font-relative units.
3. **`<style>` blocks in existing stories** — need a corpus audit: what % of
   production stories validate against the whitelist today? (Determines
   migration burden.)
4. **Interactivity semantics in agent screenshots**: Param controls, tooltips,
   hover states don't exist in the raster. Today's snapdom screenshot has the
   same property (it captures resting state), so this is not a regression —
   but the Param *control* vs *value* rendering rule must be explicit.
5. **Images in stories** (logos, user images): server-side fetch + inline;
   respect CSP and the object store.
6. **Emoji/RTL/CJK**: Takumi claims support; must be in the milestone-1 test
   matrix.
7. **Very large tables**: raster caps rows ("showing 50 of 12,340") — decide
   the cap and footer treatment; the model arguably *benefits* from the cap.
8. **Viewer-parity costs are real and Google-Docs-shaped**: text selection,
   find-in-page, a11y side-DOM, print/PDF, browser extensions that read the
   DOM. They're in scope (that's the point of committing to the full file
   type) — but they're the long tail of the schedule, and inline editing is
   deliberately solved with a DOM overlay island rather than a canvas text
   editor (§4.2) to keep that tail bounded.
9. **HTML-in-Canvas API** (Chrome 148–150 origin trial): if it goes GA
   cross-browser it can replace the hit-region/overlay/side-DOM machinery
   (browser side only — the server raster still needs Takumi-or-similar).
   Track it; don't wait for it.

---

## 6. Proposed plan

One committed scope — **stories fully on canvas** — built in dependency order.
The milestones are a build sequence, not decision gates; every line ships into
the same implementation. Everything lands behind a per-story flag
(`canvasSafe` + viewer flag), so the legacy DOM path covers non-migrated
stories until cutover.

**Milestone 1 — raster core (also the earliest kill-signal on Takumi):**
- `StoryRaster` module: parse → recipe expansion → Takumi (native + WASM),
  real fonts, fixed width.
- Golden-image tests against DOM screenshots on real production stories +
  the story-components gallery; perf targets (full story raster ≪ 100ms vs
  snapdom's ~1s); mobile-device measurements (§4.6).
- Corpus audit: CSS whitelist linter across all existing stories.
- If Takumi fails here, swap the engine behind the `StoryRaster` interface
  before anything is built on top.

**Milestone 2 — embeds:** vega chart-to-bitmap (rides the echarts→vega
cutover), table painter, pivot painter, deterministic embed sizing rules.

**Milestone 3 — consumers of the raster:** agent screenshots, crop tool,
server render endpoint. snapdom demoted to legacy fallback. (Ships user-value
early while the viewer is still in progress.)

**Milestone 4 — the canvas viewer:** tile manager (worker + OffscreenCanvas,
DPR/zoom re-raster, dirty tiles), hit-region map, overlay islands (links,
params, tooltips), side-DOM (a11y/selection/find), inline-edit
contentEditable overlay. Cutover: canvas viewer becomes the default for
`canvasSafe` stories.

**Later (out of scope here):** dashboards on the same raster core; Glide Data
Grid for interactive canvas tables.

---

## 7. Sources

- [vercel/satori](https://github.com/vercel/satori) — JSX→SVG, Yoga/flex-only; [experimental Tailwind (`tw`) via twrnc](https://github.com/vercel/satori/discussions/529)
- [Takumi](https://takumi.kane.tw/docs) / [kane50613/takumi](https://github.com/kane50613/takumi) — Rust JSX/HTML→image; flex+grid+block; native+WASM; [migration from satori](https://takumi.kane.tw/docs/migration/satori)
- [snapdom](https://snapdom.dev/) — current capture lib; [benchmark vs html2canvas](https://news.ycombinator.com/item?id=44307298)
- [Vega View API — toCanvas/toSVG, headless Node rendering](https://vega.github.io/vega/docs/api/view/), [vega usage (server-side)](https://vega.github.io/vega/usage/)
- [Glide Data Grid](https://grid.glideapps.com/) — canvas React data grid (MIT)
- [TanStack Table](https://tanstack.com/table/latest) — headless table engine (renderer-agnostic)
- [HTML-in-Canvas API origin trial (Chrome 148–150)](https://developer.chrome.com/blog/html-in-canvas-origin-trial) — `drawElementImage()`, a11y-preserving DOM-in-canvas
- [Google Docs' move to canvas rendering (2021)](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html) — the side-DOM a11y precedent

**Round 9 — user A/B comparison (production, agent-authored story).** Side-by-side
DOM vs canvas tabs on the real "Mxfood Executive Growth Story". All differences
trace to three root causes: (1) **container queries** (`@2xl:` variants) are not
evaluated by takumi → smaller headline + single-column grids; fix by pre-resolving
`@container` rules in the compiled CSS at raster width. (2) **Design-system fonts**
load via app CSS, not story `@import` → mono/serif substitution; fix by registering
the design-system font files in renderer.client. (3) **Embed island theming**
resolved from the top document's color-mode class → dark cards on light stories;
FIXED: islands are wrapped in Chakra `Theme appearance={storyColorMode}` (the
canvas equivalent of the iframe owning its document class). Also fixed: fluid
scaling (raster displayed scaled to container, geometry maps through the scale).
Remaining punch list = (1) and (2) + per-viz-type embed default heights.
