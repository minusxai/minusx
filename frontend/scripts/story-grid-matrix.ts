/**
 * Three-engine STORY-GRID guard — the real-browser net for the story `<Grid>`'s
 * view-mode CSS: calc()/CSS-variable positioning and @container stacking inside the
 * `<svg><foreignObject>` surface, live AND in the serialized capture.
 *
 * WHY A REAL BROWSER: the grid positions items purely from compiled Tailwind rules
 * (`left-[calc(var(--gi-x)/var(--g-cols)*100%)]`, `@max-2xl:static`, …). jsdom has no layout
 * engine, so whether those rules actually PLACE boxes — and whether an `<img>`-rendered SVG
 * copy resolves container queries the same way — is only observable here. The unit tier pins
 * everything else (geometry math, CSS emission, write-back).
 *
 * ZERO hand-copied CSS: the fixture stylesheet is compiled by the REAL per-story compiler
 * (`compileStoryCss` — the same call the save path makes), so a compiler change that breaks
 * grid emission fails this matrix, not just the unit test's string assertions. The fixture
 * markup mirrors the RENDERED output of components/kit/grid.tsx (same classes, same var
 * names); `__tests__` of the kit component guard that the two stay aligned.
 *
 * Fixtures + checks run from scripts/capture-matrix.ts (`npm run capture-matrix`).
 */
import type { BrowserContext } from '@playwright/test';
import { compileStoryCss } from '../lib/data/story/story-css.server';

/** Item rects authored by the fixture: 2-up band over a full-width footer (rows = 8). */
const ITEMS = [
  { id: 'a', x: 0, y: 0, w: 8, h: 5, color: 'rgb(220,60,40)' },
  { id: 'b', x: 8, y: 0, w: 4, h: 5, color: 'rgb(40,90,220)' },
  { id: 'c', x: 0, y: 5, w: 12, h: 3, color: 'rgb(30,160,90)' },
];
const COLS = 12;
const ROW_H = 86;
const ROWS = 8;

/** The kit GridItem's exact class string (view mode) — mirrored from components/kit/grid.tsx. */
const ITEM_CLASSES =
  'overflow-hidden p-[3px] absolute left-[calc(var(--gi-x)/var(--g-cols)*100%)] top-[calc(var(--gi-y)*var(--g-rh))] w-[calc(var(--gi-w)/var(--g-cols)*100%)] h-[calc(var(--gi-h)*var(--g-rh))] @max-2xl:static @max-2xl:w-full';

const gridStoryHtml = (css: string) => `
  <style>${css}</style>
  <div class="mx-story" data-design="tw">
    <div class="@container w-full" style="--g-cols:${COLS};--g-rh:${ROW_H}px;--g-rows:${ROWS}">
      <div class="relative w-full h-[calc(var(--g-rows)*var(--g-rh))] @max-2xl:h-auto">
        ${ITEMS.map((it) => `
        <div data-gi="${it.id}" class="${ITEM_CLASSES}" style="--gi-x:${it.x};--gi-y:${it.y};--gi-w:${it.w};--gi-h:${it.h}">
          <div style="width:100%;height:100%;background:${it.color}"></div>
        </div>`).join('')}
      </div>
    </div>
  </div>`;

/** In-page driver — the same surface scaffolding as story-width-matrix (AgentHtml's build shape). */
const DRIVER = (storyHtml: string) => `
  const container = document.getElementById('container');
  let iframe, doc, surface;
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  function build() {
    if (iframe) iframe.remove();
    iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;border:0;display:block';
    container.appendChild(iframe);
    doc = iframe.contentDocument;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>');
    doc.close();
    doc.body.style.margin = '0';
    doc.documentElement.style.overflowY = 'hidden';
    doc.body.style.overflowY = 'hidden';
    doc.documentElement.style.minHeight = '0';
    doc.body.style.minHeight = '0';
    surface = window.__story.mountStorySurface(doc, 'svg', 1280);
    surface.root.innerHTML = ${JSON.stringify(storyHtml)};
    window.__story.autoSizeStorySurface({ surface, iframe, doc, fluid: true });
  }

  async function settle() {
    const deadline = performance.now() + 2000;
    let last = '', stable = 0;
    while (performance.now() < deadline) {
      await frame();
      const w = Number(surface.svg.getAttribute('width'));
      const size = w + 'x' + surface.svg.getAttribute('height');
      if (size === last) stable++; else { stable = 0; last = size; }
      if (stable >= 2 && w === Math.floor(container.clientWidth)) return;
    }
  }

  async function mountAt(w) { container.style.width = w + 'px'; build(); await settle(); }

  /** Live item geometry (relative to the surface root) + capture + a pixel sample per item. */
  async function probeGrid() {
    const rootRect = surface.root.getBoundingClientRect();
    const items = {};
    for (const el of surface.root.querySelectorAll('[data-gi]')) {
      const r = el.getBoundingClientRect();
      items[el.getAttribute('data-gi')] = {
        left: Math.round(r.left - rootRect.left),
        top: Math.round(r.top - rootRect.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }
    const m = { container: container.clientWidth, rootW: Math.round(rootRect.width), items };
    const xml = await window.__story.serializeStorySvg(surface.svg);
    const img = await window.__story.storySvgToImage(xml);
    m.capturedW = img.naturalWidth;
    m.capturedH = img.naturalHeight;
    m.pixels = {};
    if (m.capturedW > 0 && m.capturedH > 0) {
      const c = document.createElement('canvas');
      c.width = m.capturedW; c.height = m.capturedH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      for (const [id, r] of Object.entries(items)) {
        const px = ctx.getImageData(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), 1, 1).data;
        m.pixels[id] = [px[0], px[1], px[2]];
      }
    }
    return m;
  }

  window.__drive = { mountAt, probeGrid };
`;

const gridPage = (storyHtml: string) => `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0">
  <div id="container" style="width:1104px"></div>
  <script src="/bundle.js"></script>
  <script>${DRIVER(storyHtml)}</script>
</body></html>`;

/** Fixture building is async: the stylesheet comes from the real per-story compiler. */
export async function buildGridFixtures(): Promise<Record<string, string>> {
  const css = await compileStoryCss('<div class="mx-story" data-design="tw"><p>x</p></div>');
  if (!css) throw new Error('story-grid-matrix: compileStoryCss returned null for a design-system story');
  return { '/grid-story.html': gridPage(gridStoryHtml(css)) };
}

interface ItemBox { left: number; top: number; width: number; height: number }
interface GridProbe {
  container: number; rootW: number;
  items: Record<string, ItemBox>;
  capturedW: number; capturedH: number;
  pixels: Record<string, [number, number, number]>;
}
interface CheckResult { name: string; pass: boolean; detail?: string }

/** Geometry tolerance: cross-engine rounding ±2px; the failure modes are tens-to-hundreds px. */
const TOL = 2;

function expectBox(f: string[], at: string, id: string, got: ItemBox | undefined, want: ItemBox) {
  if (!got) { f.push(`${at}: item ${id} missing from the surface`); return; }
  for (const k of ['left', 'top', 'width', 'height'] as const) {
    if (Math.abs(got[k] - want[k]) > TOL) {
      f.push(`${at}: item ${id} ${k}=${got[k]}px, expected ${want[k]}px (box=${JSON.stringify(got)})`);
    }
  }
}

function expectColor(f: string[], at: string, id: string, got: [number, number, number] | undefined, want: string) {
  if (!got) { f.push(`${at}: no capture pixel for item ${id}`); return; }
  const m = want.match(/rgb\((\d+),(\d+),(\d+)\)/)!;
  const wantRgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  const off = Math.max(...wantRgb.map((v, i) => Math.abs(v - got[i])));
  if (off > 12) {
    f.push(`${at}: CAPTURE pixel for item ${id} is rgb(${got.join(',')}), expected ${want} — the serialized copy did not place/paint the item where the live surface did`);
  }
}

export async function runGridChecks(ctx: BrowserContext, base: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const drive = async (script: string): Promise<GridProbe> => {
    const p = await ctx.newPage();
    try {
      await p.goto(base + '/grid-story.html');
      await p.waitForFunction('!!window.__story && !!window.__drive');
      return await p.evaluate(`(async () => { ${script} })()`) as GridProbe;
    } finally {
      await p.close();
    }
  };

  // Desktop (1104px > the 42rem/672px stacking breakpoint): 12-col positioned layout,
  // live AND in the capture's pixels.
  {
    const name = 'story grid @1104px — positioned layout live + capture pixels';
    try {
      const m = await drive('await window.__drive.mountAt(1104); return await window.__drive.probeGrid();');
      const f: string[] = [];
      const W = m.container;
      expectBox(f, 'grid@1104', 'a', m.items.a, { left: 0, top: 0, width: Math.round(W * 8 / 12), height: 5 * ROW_H });
      expectBox(f, 'grid@1104', 'b', m.items.b, { left: Math.round(W * 8 / 12), top: 0, width: Math.round(W * 4 / 12), height: 5 * ROW_H });
      expectBox(f, 'grid@1104', 'c', m.items.c, { left: 0, top: 5 * ROW_H, width: W, height: 3 * ROW_H });
      if (m.capturedH < ROWS * ROW_H - TOL) f.push(`grid@1104: capture ${m.capturedH}px tall < grid ${ROWS * ROW_H}px`);
      for (const it of ITEMS) expectColor(f, 'grid@1104', it.id, m.pixels[it.id], it.color);
      results.push({ name, pass: f.length === 0, detail: f.join(' | ') });
    } catch (e) {
      results.push({ name, pass: false, detail: String(e) });
    }
  }

  // Phone (390px < 672px): items stack in source order at full width, KEEPING their px height;
  // the surface grows to the stacked height and the capture covers it.
  {
    const name = 'story grid @390px — container-query stack live + capture pixels';
    try {
      const m = await drive('await window.__drive.mountAt(390); return await window.__drive.probeGrid();');
      const f: string[] = [];
      const W = m.container;
      expectBox(f, 'grid@390', 'a', m.items.a, { left: 0, top: 0, width: W, height: 5 * ROW_H });
      expectBox(f, 'grid@390', 'b', m.items.b, { left: 0, top: 5 * ROW_H, width: W, height: 5 * ROW_H });
      expectBox(f, 'grid@390', 'c', m.items.c, { left: 0, top: 10 * ROW_H, width: W, height: 3 * ROW_H });
      const stackedH = 13 * ROW_H;
      if (m.capturedH < stackedH - TOL) f.push(`grid@390: capture ${m.capturedH}px tall < stacked content ${stackedH}px — the @container stack did not resolve in the serialized copy`);
      for (const it of ITEMS) expectColor(f, 'grid@390', it.id, m.pixels[it.id], it.color);
      results.push({ name, pass: f.length === 0, detail: f.join(' | ') });
    } catch (e) {
      results.push({ name, pass: false, detail: String(e) });
    }
  }

  return results;
}
