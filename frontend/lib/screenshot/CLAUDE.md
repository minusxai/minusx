# Capture — surface to image

`lib/screenshot` (which path, and when) and `lib/headless-capture` (server-side story capture).
Every path is SERIALIZATION capture, not a screenshot API.

This is general infrastructure, not a story concern: `lib/screenshot` has ten consumers across
explore, views, agents and tools. The surfaces it captures are documented in
`frontend/lib/story-surface/CLAUDE.md`, which also carries the shared gotchas.

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
remount mid-settle. The wait always resolves by `timeoutMs` and returns `{ settled, busyCount }` —
degrading to a screenshot of a spinner is correct, hanging the tool is not.

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
`DISPLAY_IMAGE_MAX_PX = 1536`, `AGENT_IMAGE_PIXEL_RATIO = 2`, `AGENT_IMAGE_JPEG_QUALITY = 0.85`,
chart watermark geometry) and is dependency-free so the browser capture path, the client chart
renderer and the server Sharp/Resvg renderer can all import it.

## `lib/headless-capture` — server-side story capture

`renderStoryToImage(input)` is the only seam; callers never import a backend. `manager.ts` owns the
lifecycle: lazy singleton backend (zero cost if unused, a failed launch clears the slot so a later
render retries), a `Semaphore` bounding concurrency (default 2), an idle shutdown (default 60s,
`unref`'d), and **it never throws** — disabled or unlaunchable ⇒ `{ ok:false, reason:'unavailable' }`,
a failed capture ⇒ `reason:'error'`. `playwright-backend.server.ts` launches headless Chromium in the
same container, loads `/f/<id>` exactly as a browser user would, waits for
`[data-file-id] iframe >>> svg[data-mx-story-svg]` and `fonts.ready`, and screenshots that element.
It renders at `STORY_CANVAS_WIDTH`, not a thumbnail viewport, because the surface tracks its
container — viewport width is a **layout input**, and a narrower one collapses container-query bands
so the agent would review a layout no reader sees. `session-cookie.server.ts` mints a short-lived
NextAuth session JWT (same secret and salt NextAuth uses, carrying `tokenVersion` so the
outdated-token guard passes) rather than driving the login form. Enabled by `HEADLESS_CAPTURE=1`,
default off.

## `lib/og` — share cards

`capture-story-preview.ts` runs in the browser when a story is made public: it finds
`[data-story-capture="<id>"]`, serializes the live surface (falling back to the generic element
serializer), crops the **top band** to the 1200×630 OG aspect, and POSTs a JPEG data URL to
`/api/files/[id]/preview`. `og-image.tsx` (server) pre-blurs that screenshot with sharp — satori
cannot do CSS blur — and composes the final card via `og-cards.tsx` (`next/og` + JetBrains Mono from
`public/fonts`, org branding from `getConfigsForMode`). The composed PNG is stored in the object
store and streamed back verbatim by `app/l/[shareId]/og/route.ts` — **a story card is never rendered
at crawl time**. Only the *generic* fallback (no capture yet, revoked share, root) can render on
demand, and even that serves the committed `public/ogs/generic.png` unless the org has a custom
expanded logo. That route is a plain handler rather than Next's `opengraph-image` convention because
the convention only ever emits the dev localhost host. `og-helpers.ts`'s `ogCacheKey` embeds
`updated_at` (normalized — `pg` returns `Date`, PGLite returns ISO strings) so the cache self-busts
on every edit.
