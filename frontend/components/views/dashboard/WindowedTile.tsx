'use client'

/**
 * Tile windowing (Renderer_v2 Phase 7): a dashboard question tile renders as a lightweight
 * layout GHOST until it comes within `OVERSCAN_PX` of the viewport (IntersectionObserver);
 * once mounted it STAYS mounted (no unmount thrash on scroll — the win is initial mount cost).
 *
 * Two load-bearing contracts:
 *  - The ghost fills its grid item (`h-full`), so the dashboard's full content height — which
 *    Phase 1's marker math and the `<Viewport>` pointer depend on — is preserved exactly.
 *  - The ghost stamps `data-mx-busy="true"` and listens for `FORCE_MOUNT_TILES_EVENT`
 *    (broadcast by the capture readiness gate): a capture can never settle on ghosts, and the
 *    broadcast hydrates every tile so the capture waits on the REAL tiles' busy markers instead.
 *
 * No IntersectionObserver (jsdom, ancient browsers) → mount everything (safe fallback).
 */
import { useEffect, useRef, useState } from 'react'
import { FORCE_MOUNT_TILES_EVENT } from '@/lib/screenshot/readiness'

const OVERSCAN_PX = 600

export const WindowedTile = ({ children }: { children: React.ReactNode }) => {
  const ghostRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (mounted) return
    const el = ghostRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setMounted(true) },
      { rootMargin: `${OVERSCAN_PX}px 0px ${OVERSCAN_PX}px 0px` },
    )
    io.observe(el)
    const onForce = () => setMounted(true)
    document.addEventListener(FORCE_MOUNT_TILES_EVENT, onForce)
    return () => {
      io.disconnect()
      document.removeEventListener(FORCE_MOUNT_TILES_EVENT, onForce)
    }
  }, [mounted])

  if (!mounted) {
    return <div ref={ghostRef} data-mx-tile-ghost="" data-mx-busy="true" className="h-full w-full" />
  }
  return <>{children}</>
}
