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

export const WindowedTile = ({ children }: { children: React.ReactNode }) => {
  const ghostRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (mounted) return
    const el = ghostRef.current
    if (!el) return
    const win = el.ownerDocument.defaultView ?? window
    let raf = 0
    const check = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const vh = win.innerHeight || el.ownerDocument.documentElement.clientHeight
      if (r.top < vh + OVERSCAN_PX && r.bottom > -OVERSCAN_PX) setMounted(true)
    }
    const schedule = () => { if (!raf) raf = win.requestAnimationFrame(check) }
    const onForce = () => setMounted(true)
    check()
    el.ownerDocument.addEventListener('scroll', schedule, { capture: true, passive: true })
    win.addEventListener('resize', schedule)
    document.addEventListener(FORCE_MOUNT_TILES_EVENT, onForce)
    return () => {
      if (raf) win.cancelAnimationFrame(raf)
      el.ownerDocument.removeEventListener('scroll', schedule, { capture: true })
      win.removeEventListener('resize', schedule)
      document.removeEventListener(FORCE_MOUNT_TILES_EVENT, onForce)
    }
  }, [mounted])

  if (!mounted) {
    return <div ref={ghostRef} data-mx-tile-ghost="" data-mx-busy="true" className="h-full w-full" />
  }
  return <>{children}</>
}
