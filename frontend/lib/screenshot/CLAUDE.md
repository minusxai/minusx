# Capture — surface to image

`lib/screenshot` (which path, and when) and `lib/headless-capture` (server-side story capture).
Every path is SERIALIZATION capture, not a screenshot API: the live DOM is cloned into an
`<svg><foreignObject>`, made self-contained, and rasterized by the browser through an `<img>`.
Nothing here re-derives styles or re-implements layout.

This is general infrastructure, not a story concern: `lib/screenshot` has ten consumers across
explore, views, agents and tools.

The three tiers, in order: authoring → mounting → **capture (here)**. A **surface** is the
`<svg><foreignObject><div data-mx-story-root>` a story or dashboard mounts into inside its
same-origin iframe; it is documented in `frontend/lib/story-surface/CLAUDE.md`, which also owns the
clone-fixup and rasterize primitives this module calls (`applyScrollOffsets`, `stampFormValues`,
`svgToImage`) and the gotchas about them. The tree that gets mounted is
`frontend/lib/story-ui/CLAUDE.md`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## `lib/screenshot` — which path, and when

```
captureFileViewWithReadiness(fileId, opts)
  ├─ waitForFileViewReady(fileId)            ← readiness.ts, best-effort, always resolves
  ├─ re-resolve [data-file-id] (may have remounted mid-settle)
  └─ captureElementBlob / captureElementFullHeightBlob
        ├─ findStorySvg → serializeStorySvg → svgToImage   (story, dashboard)
        └─ serializeElementToSvg          → svgToImage     (question, notebook, report, code)
              └─ rasterToBlob: fill bg → drawImage → [drawMarkerGutter] → canvas.toBlob
```

`serialize-element.ts` is the generic path for main-document React views whose CSS lives in the
parent document. It clones into `<svg><foreignObject>`, inlines every same-origin stylesheet
(`<style>` text verbatim — CSSOM re-serialization drops rules the parser doesn't know; link sheets
via `cssRules`, absolutized against the sheet's own href), runs the lockstep fixups
(`applyScrollOffsets`, `stampFormValues`, `stampCanvases`, node filter) *before* structural drops,
removes transient portal positioners (`[data-scope][data-part="positioner"]`, `position: fixed`
overlays that would land at a nonsense document-flow position), and re-establishes the ancestor
context the detached clone lost: an outer wrapper carrying the color-mode class + `data-theme` +
`snapshotInheritedStyle` (color/font/line-height — otherwise text falls back to initial black on dark
tiles), and an inner wrapper stamped `data-mx-theme-host` so `.dark [data-mx-theme-host]` token rules
resolve. `fixed`/`sticky` chrome renders at its document-flow position — accepted divergence.

`readiness.ts` gates everything. Busy is **explicit and opt-in**: any `[data-mx-busy="true"]` inside
the view, including inside same-origin iframes (one nested level), plus an iframe whose document is
still `loading`. Each poll re-broadcasts `FORCE_MOUNT_TILES_EVENT` on `document`, so windowed
dashboard tiles (`components/views/dashboard/WindowedTile.tsx`) mount their real content and their
own busy markers then gate the settle; re-broadcasting every poll matters because the view can
remount mid-settle. The wait always resolves by `timeoutMs` (default 10 s, `settleMs` 250) and
returns `{ settled, busyCount }` — degrading to a screenshot of a spinner is correct, hanging the
tool is not.

`app-state-screenshot.ts` is the send-path attachment. Capture happens **only on send**, never
speculatively on view change (speculative warming froze the main thread for seconds while the user
typed). A one-slot cache keyed by `file id + markup hash + query-results/colorMode facet hash` makes
a repeat send instant; an **unsettled** shot is used once and deliberately not cached, because the
cache key may never change again and a cached spinner would be re-sent forever. A throwing capture
falls back to sending without an image.

`page-markers.ts` is pure band math on a **fixed document-pixel cadence** (`MARKER_CADENCE_PX = 400`)
— not a viewport fraction, so the numbered image is byte-identical across window sizes and stays a
cacheable prompt prefix. The two halves are deliberately decoupled: the badges are drawn into the
image (`draw-markers.ts`, mirroring `PageMarkerDevOverlay`'s geometry at content scale inside the
40px `pl-10` gutter marker-flagged views reserve), while the *pointer* — which bands the user is
looking at, plus per-element scroll offsets — is emitted as a tiny separate `<Viewport>` text block
(`read-viewport.ts`), so scrolling rewrites ~10 tokens and never invalidates the image before it.
`markersEnabledForAppState` gates both off one declared property, `FILE_TYPE_METADATA[type].markers`.

`constants.ts` is the single source for agent-image numbers (`AGENT_IMAGE_MAX_PX = 512`,
`AGENT_IMAGE_MAX_H_PX = 2560` — the height cap that downscales a full-height review capture instead
of cropping it, `DISPLAY_IMAGE_MAX_PX = 1536`, `AGENT_IMAGE_PIXEL_RATIO = 2`,
`AGENT_IMAGE_JPEG_QUALITY = 0.85`, chart watermark geometry) and is dependency-free so the browser
capture path, the client chart renderer and the server Sharp/Resvg renderer can all import it.

## `lib/headless-capture` — server-side story capture

`renderStoryToImage(input)` is the only seam; callers never import a backend. `manager.ts` owns the
lifecycle: lazy singleton backend (zero cost if unused, a failed launch clears the slot so a later
render retries), a `Semaphore` bounding concurrency (`DEFAULT_CAPTURE_CONCURRENCY = 2`), an idle
shutdown (`DEFAULT_IDLE_SHUTDOWN_MS = 60_000`, on an `unref`'d timer so it never holds a script
process open), and **it never throws** — disabled or unlaunchable ⇒
`{ ok:false, reason:'unavailable' }`, a failed capture ⇒ `reason:'error'`.
`playwright-backend.server.ts` launches headless Chromium in the same container, loads `/f/<id>`
exactly as a browser user would, waits via
`page.frameLocator('[data-file-id="<id>"] iframe').locator('svg[data-mx-story-svg]')` plus
`fonts.ready` and a 300 ms settle, and screenshots that element with `locator.screenshot()`. It
renders at `STORY_CANVAS_WIDTH`, not a thumbnail viewport, because the surface tracks its
container — viewport width is a **layout input**, and a narrower one collapses container-query bands
so the agent would review a layout no reader sees. `session-cookie.server.ts` mints a short-lived
NextAuth session JWT (same secret and salt NextAuth uses — salt = cookie name, secret =
`NEXTAUTH_SECRET` — carrying `tokenVersion` so the outdated-token guard passes) rather than driving
the login form. Enabled by `HEADLESS_CAPTURE=1`, default off.
`story-image-blocks.server.ts` wraps that into `renderStoryImageBlocks` (at most
`MAX_STORY_IMAGE_BLOCKS = 2` image blocks) for headless agent turns.

## Interactions with other areas

**Agent tooling.** `lib/tools/handlers/file-review.ts` and `components/explore/ChatInterface.tsx`
call into `lib/screenshot`; `agents/analyst/file-tools.ts` calls `renderStoryImageBlocks` for
headless turns, where Slack's app state has no `fileState` to hang an image on. **Contract:**
LLM-facing callers MUST branch on `readiness.settled` — an un-annotated mid-load capture reads as
broken content and triggers destructive "fixes".

**Region capture.** `components/screenshot/RegionCaptureButton.tsx` /
`ImageAnnotatorDialog.tsx` call `captureRegionBlob`, passing a `filter` that excludes the selection
overlay and a `targetBox` snapshotted at drag time (reading the box *after* the async render lets
layout drift slide the crop).

**Charts.** `components/viz/VegaChart.tsx` forces Vega's SVG renderer precisely because captures
serialize live DOM — canvas content serializes empty (`stampCanvases` is the fallback, and a tainted
canvas is skipped entirely).

**Share cards.** `lib/og` (documented in `frontend/lib/CLAUDE.md`) is a consumer, not a sibling:
`lib/og/capture-story-preview.ts` reuses `findStorySvg`/`serializeStorySvg`/`svgToImage`, falling back
to `serialize-element.ts`, then crops the top band to the 1200×630 OG aspect.

**CI / scripts.** `scripts/capture-matrix.ts` (+ `scripts/b2-surface-matrix.ts`,
`scripts/story-width-matrix.ts`, `scripts/b2-surface-drivers.tsx`) drives the real modules across
Chromium/WebKit/Firefox; `scripts/headless-capture-fidelity.ts` pixel-diffs the Playwright screenshot
against the client serialize path under an explicit threshold — that diff is what keeps the two
capture mechanisms from forking, because the Playwright backend uses `locator.screenshot()` rather
than calling `serializeStorySvg` in-page (the app bundle does not expose it on `window`).

## Gotchas

- **`headless-capture` never throws.** Distinguish `unavailable` (flag off / no Chromium — degrade
  silently) from `error` (a real capture failure).
- **A surface svg's own `getBoundingClientRect` is frame-relative.** `svgBoxInTopViewport`
  (`capture.ts`) walks up the frame chain adding each `frameElement`'s offset, because a
  region-capture selection is expressed in TOP-viewport coordinates. Comparing the two spaces
  directly crops against the wrong origin: the containment pre-gate then rejects a selection that
  really is on the surface — falling through to the generic path, which renders an iframe clone
  black — or crops the wrong band. The walk stops at the first cross-origin ancestor and keeps the
  composition it has. A selection that only *straddles* the surface edge is still cropped here and
  its margin filled with the background; only a fully off-surface selection falls through.
- **The marker gutter is an overlay and never changes canvas geometry.** `drawMarkerGutter`
  (`draw-markers.ts`) paints the badges and dashed band lines onto the already-rasterized content
  canvas at content scale, and a contract test asserts the output canvas is exactly the input's
  width. Widening the image would hand the agent a picture whose geometry differs from the page — the
  opposite of what numbered markers exist for. Badges live inside `MARKER_GUTTER_CSS_PX` (40,
  Tailwind `pl-10`), the left padding every marker-flagged main-document view reserves; **stories
  reserve nothing on purpose** and rely on their authored margins, because injecting structural
  padding would shift every curated story. Badge height carries a 14-output-pixel floor: at the
  roughly 0.45× agent scale the live overlay's 22px badge would render unreadable numerals, and the
  floored badge still fits the 40px gutter, so it never crosses into content.
- **Scale the raster, never the element.** `fitScale` picks whichever of `maxWidth`/`maxHeight` binds
  tightest (falling back to `pixelRatio`, default 0.75) and the whole element is downscaled, never
  cropped — re-laying-out the element at a target width would change what is being captured.
- **Surface-level serialization gotchas live in `frontend/lib/story-surface/CLAUDE.md`** — Blob-URL
  canvas tainting, styles injected into `<head>` being lost, and DOM state (scroll, form values,
  canvas pixels) not being markup. They apply to both paths here.

## Key files

| Task | File |
|---|---|
| Change which capture path a view takes | `frontend/lib/screenshot/capture.ts` |
| Fix a capture that loses styles/fonts/images (main document) | `frontend/lib/screenshot/serialize-element.ts` |
| Fix the same on a story/dashboard surface | `frontend/lib/story-surface/serialize.ts` |
| A capture rasterizes spinners or blank tiles | `frontend/lib/screenshot/readiness.ts` |
| Change what the agent sees on send | `frontend/lib/screenshot/app-state-screenshot.ts` |
| Change marker cadence / the `<Viewport>` pointer | `frontend/lib/screenshot/page-markers.ts`, `frontend/lib/screenshot/read-viewport.ts`, `frontend/lib/screenshot/draw-markers.ts` |
| Agent image size/quality constants | `frontend/lib/screenshot/constants.ts` |
| Server-side story image (Slack, reports, eval) | `frontend/lib/headless-capture/index.server.ts`, `frontend/lib/headless-capture/playwright-backend.server.ts` |
| Share-card look or caching | `frontend/lib/og/og-cards.tsx`, `frontend/lib/og/og-image.tsx`, `frontend/lib/og/og-helpers.ts` (docs: `frontend/lib/CLAUDE.md`) |

## Design decisions

**Headless capture needs a real browser — that is the problem, not a missing library.** Node-side SVG
rasterizers ignore `foreignObject` entirely, and Satori implements a flexbox-only subset that cannot
express story markup, so neither can stand in for the Playwright backend. The swappable-backend seam
exists to allow a *different browser*, not a pure-Node renderer.
