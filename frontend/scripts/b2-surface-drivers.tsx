/**
 * In-page drivers for the B2 dashboard-surface matrix (Renderer_v2 Phase 4) — bundled into the
 * capture-matrix browser bundle. Everything here drives the REAL shipped modules: the actual
 * `SvgPageSurface` component, the actual `serializeSurfaceSvg` capture path, and the dashboard's
 * actual grid library (`WidthProvider(Responsive)` from react-grid-layout) — only the tile
 * content is fixture markup. This is the §7.2 spike, promoted to a permanent fixture and
 * re-proven through the production code path instead of a hand-rolled svg mount.
 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import { SvgPageSurface } from '@/components/views/shared/SvgPageSurface';
import { WindowedTile } from '@/components/views/dashboard/WindowedTile';
import { findSurfaceSvg, serializeSurfaceSvg } from '@/lib/screenshot/serialize-surface';
import { svgToImage } from '@/lib/story-surface/serialize';

const RGL = WidthProvider(Responsive);

const INITIAL: Layout[] = [
  { i: 'a', x: 0, y: 0, w: 6, h: 2 },
  { i: 'b', x: 6, y: 0, w: 6, h: 2 },
  { i: 'c', x: 0, y: 2, w: 4, h: 2 },
  { i: 'd', x: 4, y: 2, w: 8, h: 2 },
];

// Tile 'a' is deliberately TOKEN-backed (--chart-1, the app palette teal #16a085, declared under
// [data-mx-theme-host] in theme-tokens.css): if the token chain breaks in the live surface or in
// the serialized copy, tile 'a' rasterizes transparent and the pixel check fails.
const TILE_BG: Record<string, string> = {
  a: 'var(--chart-1)',
  b: 'rgb(41, 128, 185)',
  c: 'rgb(192, 57, 43)',
  d: 'rgb(241, 196, 15)',
};

interface B2State { layout: Array<{ i: string; x: number; y: number; w: number; h: number }>; tileClicks: number; popClicks: number }
const state: B2State = { layout: INITIAL, tileClicks: 0, popClicks: 0 };

function GridApp() {
  const record = (layout: Layout[]) => {
    state.layout = layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  };
  return (
    <SvgPageSurface>
      <div style={{ position: 'relative', minHeight: 400 }}>
        <RGL
          className="layout"
          layouts={{ lg: INITIAL }}
          breakpoints={{ lg: 0 }}
          cols={{ lg: 12 }}
          rowHeight={80}
          margin={[6, 6]}
          containerPadding={[0, 0]}
          compactType="vertical"
          draggableHandle=".drag-handle"
          onDragStop={record}
          onResizeStop={record}
          isDraggable
          isResizable
        >
          {INITIAL.map(({ i }) => (
            <div key={i} data-tile={i} style={{ background: TILE_BG[i], position: 'relative', height: '100%' }}>
              <span
                className="drag-handle"
                style={{ position: 'absolute', top: 2, left: 2, width: 24, height: 24, background: 'rgba(0,0,0,0.4)', cursor: 'move' }}
              />
              <span style={{ position: 'absolute', bottom: 4, right: 8, color: '#fff', font: '12px sans-serif' }}>{i}</span>
            </div>
          ))}
        </RGL>
      </div>
    </SvgPageSurface>
  );
}

function EditApp() {
  return (
    <SvgPageSurface>
      <div role="region" aria-label="B2 fixture region" style={{ padding: 16, font: '14px sans-serif' }}>
        <input id="b2input" type="text" style={{ width: 240, display: 'block', marginBottom: 12 }} />
        <div
          id="b2ce"
          contentEditable
          suppressContentEditableWarning
          style={{ minHeight: 40, border: '1px solid #999', marginBottom: 12, padding: 4 }}
        >
          seed
        </div>
        <p id="b2p" style={{ userSelect: 'text' }}>
          selectable paragraph text for the selection check spanning enough words to be unambiguous
        </p>
      </div>
    </SvgPageSurface>
  );
}

function StickyApp() {
  return (
    <SvgPageSurface>
      <div id="b2scroll" style={{ height: 200, overflow: 'auto' }}>
        <div id="b2sticky" style={{ position: 'sticky', top: 0, height: 30, background: 'rgb(30, 30, 200)', color: '#fff' }}>
          pinned row
        </div>
        <div style={{ height: 1200, background: 'linear-gradient(rgb(240,240,240), rgb(200,200,200))' }}>tall content</div>
      </div>
    </SvgPageSurface>
  );
}

function PopoverApp() {
  const [, force] = useState(0);
  return (
    <>
      <SvgPageSurface>
        <div
          id="b2tile"
          onClick={() => { state.tileClicks++; force((n) => n + 1); }}
          style={{ height: 220, background: 'rgb(22, 160, 133)', color: '#fff', padding: 8 }}
        >
          tile under the portal
        </div>
      </SvgPageSurface>
      {createPortal(
        <div style={{ position: 'fixed', top: 30, left: 30, zIndex: 50, background: '#fff', border: '1px solid #333', padding: 8 }}>
          <button id="b2pop" onClick={() => { state.popClicks++; force((n) => n + 1); }}>popover action</button>
          <span>PORTAL_ONLY_TEXT</span>
        </div>,
        document.body,
      )}
    </>
  );
}

// The REAL WindowedTile inside the REAL surface: a below-fold tile must be a busy ghost, then
// hydrate on scroll. This is exactly the fixture jsdom can't provide (no layout): the original
// IntersectionObserver implementation passed every jsdom test and was silently dead in real
// engines (IO callbacks never fire for foreignObject descendants).
function WindowedApp() {
  return (
    <SvgPageSurface>
      <div style={{ height: 1800, background: 'rgb(238,238,238)' }}>spacer above the fold</div>
      <div style={{ height: 200 }}>
        <WindowedTile>
          <div id="b2wcontent" style={{ height: 200, background: 'rgb(22, 160, 133)' }}>hydrated tile</div>
        </WindowedTile>
      </div>
    </SvgPageSurface>
  );
}

const APPS: Record<string, () => React.ReactElement> = {
  grid: GridApp,
  edit: EditApp,
  sticky: StickyApp,
  popover: PopoverApp,
  windowed: WindowedApp,
};

function mount(kind: string, container: HTMLElement): void {
  const App = APPS[kind];
  createRoot(container).render(<App />);
}

/**
 * Serialize the page's live surface, rasterize it (getImageData THROWS on taint), and report
 * which of the wanted [r,g,b] colors are present plus the captured dimensions.
 */
async function captureProbe(colors: Array<[number, number, number]>): Promise<{ untainted: boolean; found: boolean[]; w: number; h: number; xml: string }> {
  const svg = findSurfaceSvg(document.body);
  if (!svg) throw new Error('no surface svg on page');
  const xml = await serializeSurfaceSvg(svg);
  const img = await svgToImage(xml);
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data; // THROWS if tainted
  const found = colors.map(([r, g, b]) => {
    for (let i = 0; i < px.length; i += 4) {
      if (Math.abs(px[i] - r) <= 30 && Math.abs(px[i + 1] - g) <= 30 && Math.abs(px[i + 2] - b) <= 30) return true;
    }
    return false;
  });
  return { untainted: true, found, w, h, xml };
}

export const B2_DRIVER = { mount, captureProbe, state };
