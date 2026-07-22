/**
 * SvgPageSurface (Renderer_v2 Phase 4, Option B2): hosts main-document view content (the dashboard
 * grid) inside `<svg data-mx-surface-svg><foreignObject>` so capture can serialize the LIVE svg the
 * user is looking at. The surface renders its own `[data-mx-theme-host]` root so shadcn tokens
 * resolve both live and in the serialized copy (which is detached from the app-shell host).
 */
import React from 'react'
import { render } from '@testing-library/react'
import { SvgPageSurface } from '@/components/views/shared/SvgPageSurface'
import { SURFACE_SVG_ATTR } from '@/lib/screenshot/serialize-surface'

describe('SvgPageSurface', () => {
  it('renders children inside svg[data-mx-surface-svg] > foreignObject > theme-host root', () => {
    render(
      <SvgPageSurface>
        <p>tile content</p>
      </SvgPageSurface>,
    )
    const svg = document.querySelector(`svg[${SURFACE_SVG_ATTR}]`)
    expect(svg).toBeTruthy()
    const fo = svg!.querySelector('foreignObject')
    expect(fo).toBeTruthy()
    const root = fo!.querySelector('[data-mx-theme-host]')
    expect(root).toBeTruthy()
    expect(root!.textContent).toContain('tile content')
  })

  it('sizes the svg from the measured content (attrs present and numeric)', () => {
    render(
      <SvgPageSurface>
        <div style={{ height: 200 }}>content</div>
      </SvgPageSurface>,
    )
    const svg = document.querySelector(`svg[${SURFACE_SVG_ATTR}]`)!
    // jsdom has no layout — the contract here is that explicit numeric width/height attributes
    // exist (an svg without them defaults to 300x150 and clips the grid), kept in sync by
    // ResizeObserver in real engines (asserted in the browser matrix, not here).
    expect(Number(svg.getAttribute('height'))).not.toBeNaN()
    expect(Number(svg.getAttribute('width'))).not.toBeNaN()
    expect(svg.getAttribute('style') || '').toContain('display: block')
  })
})
