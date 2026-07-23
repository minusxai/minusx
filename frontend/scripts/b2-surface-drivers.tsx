/**
 * In-page drivers for the B2 dashboard-surface matrix (Renderer_v2 Phase 4, re-hosted on the
 * Phase 8 self-contained iframe surface) — bundled into the capture-matrix browser bundle.
 * Everything here drives the REAL shipped modules: the actual `DashboardSurface` host (iframe +
 * svg surface + nested root + chrome stylesheet), the actual story-serializer capture path the
 * production dashboard uses (`findStorySvg`/`serializeStorySvg`), the real `WindowedTile`, and
 * the dashboard's actual grid library (`WidthProvider(Responsive)` from react-grid-layout) —
 * only the tile content is fixture markup.
 *
 * SELF-CONTAINMENT IS THE FIXTURE'S PREMISE: the harness pages carry ZERO stylesheets (no RGL
 * css, no token css — see b2-surface-matrix.ts). Everything the fixtures need must come from
 * the iframe's own chrome stylesheet; a token-backed tile that rasterizes empty means the
 * surface depended on the environment after all.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Responsive, type Layout } from 'react-grid-layout';
import DashboardSurface from '@/components/views/shared/DashboardSurface';
import { WindowedTile } from '@/components/views/dashboard/WindowedTile';
import { useSurfaceWidth } from '@/lib/dashboard-surface/surface-width';
import { findStorySvg, serializeStorySvg, svgToImage } from '@/lib/story-surface/serialize';

// Same contract as production DashboardView (Phase 8): NO WidthProvider — its polyfill observer
// is deaf inside the iframe realm; the grid consumes the surface-provided width directly.
const RGL = Responsive;

const INITIAL: Layout[] = [
  { i: 'a', x: 0, y: 0, w: 6, h: 2 },
  { i: 'b', x: 6, y: 0, w: 6, h: 2 },
  { i: 'c', x: 0, y: 2, w: 4, h: 2 },
  { i: 'd', x: 4, y: 2, w: 8, h: 2 },
];

// Tile 'a' is deliberately TOKEN-backed (--chart-1, the app palette teal #16a085, declared by
// the chrome stylesheet's :root block INSIDE the iframe): if the self-contained token chain
// breaks — live or in the serialized copy — tile 'a' rasterizes transparent and the pixel
// check fails.
const TILE_BG: Record<string, string> = {
  a: 'var(--chart-1)',
  b: 'rgb(41, 128, 185)',
  c: 'rgb(192, 57, 43)',
  d: 'rgb(241, 196, 15)',
};

interface B2State { layout: Array<{ i: string; x: number; y: number; w: number; h: number }>; tileClicks: number; popClicks: number }
const state: B2State = { layout: INITIAL, tileClicks: 0, popClicks: 0 };

// Mount/drag transitions are cosmetic and make position probes time-dependent — off for the
// fixture, INSIDE the surface (the top page carries no css by design). Production does the same
// inside DashboardView's region.
const NoTransitions = () => <style>{'.react-grid-item { transition: none !important; }'}</style>;

function GridBody() {
  const width = useSurfaceWidth() ?? 940;
  const record = (layout: Layout[]) => {
    state.layout = layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  };
  return (
    <>
      <NoTransitions />
      {/* Mode-differing token probe: --muted is light-gray in light mode, near-black in dark —
          resolved by the CHROME stylesheet inside the iframe, keyed off the iframe html's mode
          class (DashboardSurface colorMode prop). */}
      <div id="mode-probe" style={{ height: 24, background: 'var(--muted)' }} />
      <div style={{ position: 'relative', minHeight: 400 }}>
        <RGL
          className="layout"
          width={width}
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
    </>
  );
}

function EditBody() {
  return (
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
  );
}

function StickyBody() {
  return (
    <div id="b2scroll" style={{ height: 200, overflow: 'auto' }}>
      <div id="b2sticky" style={{ position: 'sticky', top: 0, height: 30, background: 'rgb(30, 30, 200)', color: '#fff' }}>
        pinned row
      </div>
      <div style={{ height: 1200, background: 'linear-gradient(rgb(240,240,240), rgb(200,200,200))' }}>tall content</div>
    </div>
  );
}

function PopoverBody() {
  return (
    <>
      <div
        id="b2tile"
        onClick={() => { state.tileClicks++; }}
        style={{ height: 220, background: 'rgb(22, 160, 133)', color: '#fff', padding: 8 }}
      >
        tile under the portal
      </div>
      {/* A fixed overlay in the TOP document (chat panel / app modal over the dashboard): must
          stay clickable above the iframe, must never land in the surface capture. */}
      {createPortal(
        <div style={{ position: 'fixed', top: 30, left: 30, zIndex: 50, background: '#fff', border: '1px solid #333', padding: 8 }}>
          <button id="b2pop" onClick={() => { state.popClicks++; }}>popover action</button>
          <span>PORTAL_ONLY_TEXT</span>
        </div>,
        document.body,
      )}
    </>
  );
}

// The REAL WindowedTile inside the REAL surface: a below-fold tile must be a busy ghost, then
// hydrate when the TOP page scrolls — the tile's own gBCR is iframe-relative, so this is the
// real-engine proof of the Phase 8c frame-composed visibility math (jsdom can't provide it).
function WindowedBody() {
  return (
    <>
      <div style={{ height: 1800, background: 'rgb(238,238,238)' }}>spacer above the fold</div>
      <div style={{ height: 200 }}>
        <WindowedTile>
          <div id="b2wcontent" style={{ height: 200, background: 'rgb(22, 160, 133)' }}>hydrated tile</div>
        </WindowedTile>
      </div>
    </>
  );
}

const BODIES: Record<string, () => React.ReactElement> = {
  grid: GridBody,
  edit: EditBody,
  sticky: StickyBody,
  popover: PopoverBody,
  windowed: WindowedBody,
};

let mounted: { root: Root; kind: string } | null = null;

function renderApp(kind: string, root: Root, mode: 'light' | 'dark'): void {
  const Body = BODIES[kind];
  root.render(
    <DashboardSurface colorMode={mode}>
      <Body />
    </DashboardSurface>,
  );
}

function mount(kind: string, container: HTMLElement): void {
  mounted = { root: createRoot(container), kind };
  renderApp(kind, mounted.root, 'light');
}

/** Switch the surface's color mode WITHOUT a rebuild (drives the prop, like the app does). */
function setMode(mode: 'light' | 'dark'): void {
  if (mounted) renderApp(mounted.kind, mounted.root, mode);
}

/**
 * Serialize the live surface through the PRODUCTION dashboard capture path (story serializer —
 * Phase 8 unified them), rasterize it (getImageData THROWS on taint), and report which of the
 * wanted [r,g,b] colors are present plus the captured dimensions.
 */
async function captureProbe(colors: Array<[number, number, number]>): Promise<{ untainted: boolean; found: boolean[]; w: number; h: number; xml: string }> {
  const svg = findStorySvg(document.body);
  if (!svg) throw new Error('no surface svg on page');
  const xml = await serializeStorySvg(svg);
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

export const B2_DRIVER = { mount, setMode, captureProbe, state };
