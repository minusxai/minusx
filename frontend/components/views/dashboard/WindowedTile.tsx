'use client'

/**
 * Tile windowing (Renderer_v2 Phase 7): a dashboard question tile renders as a lightweight
 * layout GHOST until it comes within `OVERSCAN_PX` of the viewport; once mounted it STAYS
 * mounted (no unmount thrash on scroll — the win is initial mount cost).
 *
 * Visibility is a SCROLL/RESIZE + getBoundingClientRect check, deliberately NOT
 * IntersectionObserver: the dashboard lives inside the B2 `<svg><foreignObject>` surface, and
 * IO callbacks never fire for foreignObject descendants (verified in Chromium — not even the
 * mandatory initial observation), while gBCR is correct there (capture-matrix `b2-*` proof).
 * The scroll listener is capture-phase on the document so any ancestor scroller counts, and
 * rAF-throttled so it costs one rect read per frame at most.
 *
 * Two load-bearing contracts:
 *  - The ghost fills its grid item (`h-full`), so the dashboard's full content height — which
 *    Phase 1's marker math and the `<Viewport>` pointer depend on — is preserved exactly.
 *  - The ghost stamps `data-mx-busy="true"` and listens for `FORCE_MOUNT_TILES_EVENT`
 *    (broadcast by the capture readiness gate): a capture can never settle on ghosts, and the
 *    broadcast hydrates every tile so the capture waits on the REAL tiles' busy markers instead.
 */
import { useEffect, useRef, useState } from 'react'
import { FORCE_MOUNT_TILES_EVENT } from '@/lib/screenshot/readiness'

const OVERSCAN_PX = 600

/**
 * The tile's rect in TOP-viewport space, plus the TOP viewport height (Phase 8c). Inside the
 * self-contained dashboard IFRAME the tile's own gBCR is relative to the iframe viewport — and
 * the iframe is content-height (it never scrolls internally), so measured against ITS OWN
 * window every tile is always "visible" and windowing silently dies. Compose the rect up
 * through the same-origin frame chain and measure against the top window instead. A
 * frameElement access that throws (cross-origin ancestor — not ours) stops the walk at the
 * frame measured so far.
 *
 * `empty` flags an all-zero rect: Firefox reports 0/0/0x0 for iframe content that has not been
 * reflowed yet, and treating that as "at the viewport origin → visible" hydrated every
 * below-fold tile at mount (windowing silently dead — real-engine matrix catch). An empty rect
 * means visibility is UNKNOWABLE; the caller must re-check on a later frame/event, not mount.
 */
export function tileViewportRect(el: Element): { top: number; bottom: number; viewportHeight: number; empty: boolean } {
  const r = el.getBoundingClientRect()
  const empty = r.width === 0 && r.height === 0
  let top = r.top
  let bottom = r.bottom
  let win: (Window & typeof globalThis) | Window | null = el.ownerDocument.defaultView
  try {
    while (win && win.frameElement) {
      const fr = win.frameElement.getBoundingClientRect()
      top += fr.top
      bottom += fr.top
      win = win.parent === win ? null : win.parent
    }
  } catch {
    // cross-origin ancestor — keep the composition up to the last same-origin frame
  }
  const viewportHeight = (win && win.innerHeight) || el.ownerDocument.documentElement.clientHeight
  return { top, bottom, viewportHeight, empty }
}

/** Every same-origin window from the element's own frame up to the top (for scroll/resize listeners). */
function frameChainWindows(el: Element): Window[] {
  const wins: Window[] = []
  let win: Window | null = el.ownerDocument.defaultView
  try {
    while (win) {
      wins.push(win)
      win = win.frameElement && win.parent !== win ? win.parent : null
    }
  } catch {
    // cross-origin ancestor — listen on what we reached
  }
  return wins
}

export const WindowedTile = ({ children }: { children: React.ReactNode }) => {
  const ghostRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (mounted) return
    const el = ghostRef.current
    if (!el) return
    const win = el.ownerDocument.defaultView ?? window
    // Pre-layout empty-rect retries (Firefox iframe): bounded so an environment that NEVER
    // lays out (jsdom) falls through to the plain predicate instead of spinning forever.
    let emptyRetries = 10
    // Inside the dashboard iframe `win` is the FRAME's window — jsdom frame windows can lack
    // rAF, so fall back to the top-realm one (timing only; correctness is the rect math).
    const requestFrame: (cb: FrameRequestCallback) => number =
      typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : window.requestAnimationFrame.bind(window)
    const cancelFrame: (id: number) => void =
      typeof win.cancelAnimationFrame === 'function' ? win.cancelAnimationFrame.bind(win) : window.cancelAnimationFrame.bind(window)
    let raf = 0
    const check = () => {
      raf = 0
      // Top-viewport space (Phase 8c): inside the dashboard iframe the scroller and viewport
      // are the TOP document's, so the rect is composed up through the frame chain.
      const { top, bottom, viewportHeight, empty } = tileViewportRect(el)
      // Pre-layout (Firefox iframe): an empty rect can't prove visibility — re-check on the
      // next frames instead of mounting (the height-application resize event also
      // re-triggers). Retries exhausted → fall through to the plain predicate (zero-rect
      // semantics = the pre-8c behavior, and what the jsdom suites characterize).
      if (empty && emptyRetries > 0) { emptyRetries--; schedule(); return }
      if (top < viewportHeight + OVERSCAN_PX && bottom > -OVERSCAN_PX) setMounted(true)
    }
    const schedule = () => { if (!raf) raf = requestFrame(check) }
    const onForce = () => setMounted(true)
    check()
    // Scroll can happen in ANY document up the frame chain (the top page scroller when the
    // dashboard is iframed); listen capture-phase on each so every ancestor scroller counts.
    // Guarded: a frame window can be DETACHED by teardown time (surface rebuild tore the
    // iframe document down first) — its `document` is gone and must not crash the cleanup.
    const wins = frameChainWindows(el)
    const eachWin = (fn: (w: Window) => void) => wins.forEach((w) => { try { fn(w) } catch { /* detached frame */ } })
    eachWin((w) => w.document.addEventListener('scroll', schedule, { capture: true, passive: true }))
    eachWin((w) => w.addEventListener('resize', schedule))
    document.addEventListener(FORCE_MOUNT_TILES_EVENT, onForce)
    return () => {
      if (raf) cancelFrame(raf)
      eachWin((w) => w.document.removeEventListener('scroll', schedule, { capture: true }))
      eachWin((w) => w.removeEventListener('resize', schedule))
      document.removeEventListener(FORCE_MOUNT_TILES_EVENT, onForce)
    }
  }, [mounted])

  if (!mounted) {
    return <div ref={ghostRef} data-mx-tile-ghost="" data-mx-busy="true" className="h-full w-full" />
  }
  return <>{children}</>
}
