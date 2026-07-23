'use client'

/**
 * SvgPageSurface (Renderer_v2 Phase 4, Option B2): hosts main-document view content — the
 * dashboard grid — inside `<svg data-mx-surface-svg><foreignObject>`, so capture can serialize
 * the LIVE svg the user is looking at (lib/screenshot/serialize-surface.ts) instead of cloning
 * the subtree into a fresh wrapper. foreignObject content is real, live, interactive DOM
 * (drag/resize/focus/contentEditable all verified on Chromium + WebKit + Firefox — §7.2 and the
 * capture-matrix b2 fixtures), so the view behaves identically.
 *
 * Sizing is the one real cost of the surface: an <svg> does NOT auto-size to its foreignObject
 * content (it defaults to 300x150 and clips), so this component measures the content root and
 * pushes explicit width/height attributes on every change (ResizeObserver; jsdom fallback is a
 * mount-time measure).
 *
 * The surface renders its own `[data-mx-theme-host]` on the content root: live, the app-shell
 * ancestor host already provides the shadcn tokens (values identical, nesting harmless) — but the
 * SERIALIZED copy is detached from that ancestor, and a statically rendered host travels with the
 * clone, keeping token-backed styles resolved in captures.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { SURFACE_SVG_ATTR } from '@/lib/screenshot/serialize-surface'

interface SvgPageSurfaceProps {
  children: React.ReactNode
}

export const SvgPageSurface = ({ children }: SvgPageSurfaceProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  // Chromium paint-invalidation workaround (verified live): after a RELAYOUT of transformed
  // content inside <foreignObject> (sidebar toggle / breakpoint change re-positions the grid
  // tiles), the screen keeps the STALE pixels — DOM and layout are correct, but the old paint
  // survives until an unrelated invalidation (e.g. a scroll). Toggling the svg onto and off its
  // own compositing layer right after each committed size change forces a full subtree repaint.
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof requestAnimationFrame !== 'function') return
    const raf = requestAnimationFrame(() => {
      svg.style.transform = 'translateZ(0)'
      requestAnimationFrame(() => { svg.style.transform = '' })
    })
    return () => cancelAnimationFrame(raf)
  }, [size])

  useLayoutEffect(() => {
    const host = hostRef.current
    const content = contentRef.current
    if (!host || !content) return
    const measure = () => {
      // Width follows the CONTAINER (the grid must lay out at the width the page gives it);
      // height follows the CONTENT (the grid grows, the page scrolls).
      const w = Math.ceil(host.getBoundingClientRect().width)
      const h = Math.ceil(content.getBoundingClientRect().height)
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    // Trailing debounce: an ANIMATED pane change (sidebar toggle transitions its width over
    // ~300ms) fires the observer every frame — each tick would relayout the grid and resize
    // every Vega view. Consolidating to one measure after the animation settles turns a toggle
    // into a single relayout + repaint instead of ~20.
    let t = 0
    const scheduleMeasure = () => {
      window.clearTimeout(t)
      t = window.setTimeout(measure, 120)
    }
    const ro = new ResizeObserver(scheduleMeasure)
    ro.observe(host)
    ro.observe(content)
    return () => {
      window.clearTimeout(t)
      ro.disconnect()
    }
  }, [])

  return (
    <div ref={hostRef} style={{ width: '100%' }}>
      <svg
        ref={svgRef}
        {...{ [SURFACE_SVG_ATTR]: '' }}
        width={size.w}
        height={size.h}
        style={{ display: 'block', width: '100%', height: size.h, overflow: 'visible' }}
      >
        <foreignObject width="100%" height="100%" style={{ overflow: 'visible' }}>
          <div ref={contentRef} data-mx-theme-host="">
            {children}
          </div>
        </foreignObject>
      </svg>
    </div>
  )
}
