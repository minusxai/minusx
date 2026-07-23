/**
 * Three-engine B2 DASHBOARD-SURFACE matrix (Renderer_v2 Phase 4) — the §7.2 spike promoted to a
 * permanent fixture, re-proven through the PRODUCTION code path: the shipped `SvgPageSurface`
 * component, the shipped `serializeSurfaceSvg` capture, and the dashboard's real grid library.
 *
 * What only a real layout engine can assert, per engine (Chromium/WebKit/Firefox):
 *  - the grid lays out at the container width INSIDE foreignObject (WidthProvider measures there);
 *  - real mouse drag + resize COMMIT layout changes through react-grid-layout;
 *  - the live-svg capture is untainted and contains every tile's pixels — including a
 *    TOKEN-backed tile (--chart-1 under [data-mx-theme-host]), so the shadcn token chain is
 *    proven in the serialized copy, not just live;
 *  - text EDITING inside foreignObject: input focus/typing/caret, contenteditable typing, and the
 *    typed value baked into the capture;
 *  - text SELECTION works across foreignObject content, and the content is exposed to the
 *    accessibility tree (role=region resolvable by name);
 *  - `position: sticky` pins inside a foreignObject scroll container;
 *  - a fixed-position PORTAL over the surface receives clicks (hit-testing above the svg), the
 *    surface below stays interactive, and the portal is EXCLUDED from the capture.
 *
 * Fixtures + checks are exported and run from scripts/capture-matrix.ts (`npm run capture-matrix`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Appended to the capture-matrix bundle entry: the real B2 driver modules, on `window.__b2`. */
export const B2_BUNDLE_ENTRY = `
  import { B2_DRIVER } from '@/scripts/b2-surface-drivers';
  (window as unknown as { __b2: object }).__b2 = B2_DRIVER;
`;

// react-grid-layout's stylesheet is load-bearing for the fixture (item positioning + the resize
// handle); theme-tokens.css proves the [data-mx-theme-host] token chain end-to-end. Both are
// inlined so the fixtures stay hermetic. Unknown at-rules in the token file (@theme inline) are
// skipped by the browser's CSS parser — the host blocks still apply.
const RGL_CSS = readFileSync(path.join(ROOT, 'node_modules', 'react-grid-layout', 'css', 'styles.css'), 'utf8');
const TOKENS_CSS = readFileSync(path.join(ROOT, 'app', 'theme-tokens.css'), 'utf8');

// Mount/drag transitions are cosmetic and make position probes time-dependent (an item's
// computed transform crawls toward its target for ~1s under headless load) — off for the fixture.
const NO_TRANSITION_CSS = '.react-grid-item { transition: none !important; }';

const b2Page = (kind: string, width = 940) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${RGL_CSS}\n${TOKENS_CSS}\n${NO_TRANSITION_CSS}</style></head>
<body style="margin:0">
  <div id="container" style="width:${width}px"></div>
  <script src="/bundle.js"></script>
  <script>window.__b2.mount('${kind}', document.getElementById('container')); window.__b2ready = true;</script>
</body></html>`;

export const B2_FIXTURES: Record<string, string> = {
  '/b2-grid.html': b2Page('grid'),
  '/b2-edit.html': b2Page('edit'),
  '/b2-sticky.html': b2Page('sticky'),
  '/b2-popover.html': b2Page('popover'),
  '/b2-windowed.html': b2Page('windowed'),
};

interface CheckResult { name: string; pass: boolean; detail?: string }

/** Wait until the surface svg has a real measured height (ResizeObserver has fired). */
const READY = `!!window.__b2ready && !!document.querySelector('svg[data-mx-surface-svg]') && Number(document.querySelector('svg[data-mx-surface-svg]').getAttribute('height')) > 50`;

export async function runB2Checks(ctx: BrowserContext, base: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const run = async (name: string, url: string, fn: (p: import('@playwright/test').Page) => Promise<CheckResult>) => {
    const p = await ctx.newPage();
    try {
      await p.goto(base + url);
      await p.waitForFunction(READY);
      results.push({ ...(await fn(p)), name });
    } catch (e) {
      results.push({ name, pass: false, detail: String(e) });
    } finally {
      await p.close();
    }
  };

  await run('b2 grid lays out at container width inside foreignObject', '/b2-grid.html', async (p) => {
    const w = await p.evaluate(`document.querySelector('[data-tile="a"]').getBoundingClientRect().width`) as number;
    // 6 of 12 cols in a 940px container with 6px margins ≈ 461px.
    const pass = w > 440 && w < 480;
    return { name: '', pass, detail: `tile-a width=${Math.round(w)} (expect ~461)` };
  });

  await run('b2 real mouse drag commits a layout change through RGL', '/b2-grid.html', async (p) => {
    const handle = await p.locator('[data-tile="b"] .drag-handle').boundingBox();
    if (!handle) return { name: '', pass: false, detail: 'drag handle not found' };
    const sx = handle.x + handle.width / 2, sy = handle.y + handle.height / 2;
    await p.mouse.move(sx, sy);
    await p.mouse.down();
    await p.mouse.move(sx - 300, sy + 180, { steps: 15 });
    await p.mouse.up();
    const b = await p.evaluate(`window.__b2.state.layout.find(l => l.i === 'b')`) as { x: number; y: number };
    const pass = !!b && (b.x !== 6 || b.y !== 0);
    return { name: '', pass, detail: `b moved (6,0) → (${b?.x},${b?.y})` };
  });

  await run('b2 real mouse resize commits through RGL', '/b2-grid.html', async (p) => {
    const handle = await p.locator('[data-tile="a"] .react-resizable-handle').boundingBox();
    if (!handle) return { name: '', pass: false, detail: 'resize handle not found' };
    const sx = handle.x + handle.width / 2, sy = handle.y + handle.height / 2;
    await p.mouse.move(sx, sy);
    await p.mouse.down();
    await p.mouse.move(sx + 160, sy + 100, { steps: 12 });
    await p.mouse.up();
    const a = await p.evaluate(`window.__b2.state.layout.find(l => l.i === 'a')`) as { w: number; h: number };
    const pass = !!a && (a.w > 6 || a.h > 2);
    return { name: '', pass, detail: `a resized 6x2 → ${a?.w}x${a?.h}` };
  });

  await run('b2 live-svg capture untainted; every tile present incl. token-backed (--chart-1)', '/b2-grid.html', async (p) => {
    const r = await p.evaluate(`window.__b2.captureProbe([[22,160,133],[41,128,185],[192,57,43],[241,196,15]])`) as { untainted: boolean; found: boolean[]; w: number; h: number };
    const pass = r.untainted && r.found.every(Boolean) && r.w > 900;
    return { name: '', pass, detail: `found=${r.found.join(',')} ${r.w}x${r.h}` };
  });

  await run('b2 SCREEN paint tracks relayout inside foreignObject (no stale pixels after container resize)', '/b2-grid.html', async (p) => {
    // Shrink the container: RGL re-lays-out the tiles at new positions/widths. The Chromium
    // foreignObject bug leaves the OLD paint on screen (layout right, pixels stale) — so this
    // asserts against a real SCREENSHOT, not the serializer.
    await p.evaluate(`document.getElementById('container').style.width = '500px'`);
    await p.waitForTimeout(600); // surface RO + RGL relayout + the repaint nudge
    const shot = await p.screenshot();
    const png = shot;
    // Decode via the page (canvas) — check that no tile color is painted beyond the new width.
    const probe = await p.evaluate(`(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const scale = img.naturalWidth / window.innerWidth; // device pixel ratio of the shot
      const beyond = ctx.getImageData(Math.round(560 * scale), 0, Math.round(200 * scale), Math.round(300 * scale)).data;
      let stale = 0;
      for (let i = 0; i < beyond.length; i += 4) {
        const [r, g, b] = [beyond[i], beyond[i+1], beyond[i+2]];
        if ((Math.abs(r-41)<30 && Math.abs(g-128)<30 && Math.abs(b-185)<30) || (Math.abs(r-22)<30 && Math.abs(g-160)<30 && Math.abs(b-133)<30) || (Math.abs(r-192)<30 && Math.abs(g-57)<30 && Math.abs(b-43)<30) || (Math.abs(r-241)<30 && Math.abs(g-196)<30 && Math.abs(b-15)<30)) stale++;
      }
      const inside = ctx.getImageData(0, 0, Math.round(490 * scale), Math.round(300 * scale)).data;
      let present = 0;
      for (let i = 0; i < inside.length; i += 4) {
        const [r, g, b] = [inside[i], inside[i+1], inside[i+2]];
        if (Math.abs(r-22)<30 && Math.abs(g-160)<30 && Math.abs(b-133)<30) present++;
      }
      return { stale, present };
    })(${JSON.stringify(png.toString('base64'))})`) as { stale: number; present: number };
    const pass = probe.stale < 50 && probe.present > 500;
    return { name: '', pass, detail: `stalePxBeyondNewWidth=${probe.stale} tilePxInside=${probe.present}` };
  });

  await run('b2 DARK-mode capture resolves .dark theme-host tokens (mode stamp is an ANCESTOR of the host)', '/b2-grid.html', async (p) => {
    await p.evaluate(`document.documentElement.classList.add('dark')`);
    // Probe the strip's pixel in the captured raster: dark --muted ≈ oklch(0.269 0 0) ≈ rgb(~46).
    const r = await p.evaluate(`(async () => {
      const probe = await window.__b2.captureProbe([]);
      const img = await (async () => { const i = new Image(); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(probe.xml); await i.decode(); return i; })();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(30, 10, 1, 1).data;
      return { r: px[0], g: px[1], b: px[2] };
    })()`) as { r: number; g: number; b: number };
    await p.evaluate(`document.documentElement.classList.remove('dark')`);
    const pass = r.r < 120 && r.g < 120 && r.b < 120; // dark gray, NOT the light-mode ~rgb(247)
    return { name: '', pass, detail: `probePx=${r.r},${r.g},${r.b} (dark --muted expected <120)` };
  });

  await run('b2 input editing in foreignObject: focus, typing, caret; value baked into capture', '/b2-edit.html', async (p) => {
    await p.click('#b2input');
    await p.keyboard.type('hello caret');
    const st = await p.evaluate(`(() => { const i = document.getElementById('b2input'); return { v: i.value, focused: document.activeElement === i, caret: i.selectionStart }; })()`) as { v: string; focused: boolean; caret: number };
    const cap = await p.evaluate(`window.__b2.captureProbe([])`) as { xml: string };
    const baked = cap.xml.includes('value="hello caret"');
    const pass = st.v === 'hello caret' && st.focused && st.caret === 11 && baked;
    return { name: '', pass, detail: `value=${JSON.stringify(st.v)} focused=${st.focused} caret=${st.caret} baked=${baked}` };
  });

  await run('b2 contenteditable typing in foreignObject', '/b2-edit.html', async (p) => {
    await p.click('#b2ce');
    await p.keyboard.type(' typed-into-ce');
    const text = await p.evaluate(`document.getElementById('b2ce').textContent`) as string;
    const focused = await p.evaluate(`document.activeElement === document.getElementById('b2ce')`) as boolean;
    const pass = text.includes('typed-into-ce') && focused;
    return { name: '', pass, detail: `text=${JSON.stringify(text)} focused=${focused}` };
  });

  await run('b2 text selection + accessibility exposure across foreignObject content', '/b2-edit.html', async (p) => {
    await p.click('#b2p', { clickCount: 3 });
    const selected = await p.evaluate(`window.getSelection().toString()`) as string;
    const region = await p.getByRole('region', { name: 'B2 fixture region' }).count();
    const pass = selected.trim().length > 10 && region === 1;
    return { name: '', pass, detail: `selected=${JSON.stringify(selected.slice(0, 40))} regionByRole=${region}` };
  });

  await run('b2 position:sticky pins inside a foreignObject scroll container', '/b2-sticky.html', async (p) => {
    const r = await p.evaluate(`(async () => {
      const scroll = document.getElementById('b2scroll');
      const sticky = document.getElementById('b2sticky');
      scroll.scrollTop = 400;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const st = sticky.getBoundingClientRect().top;
      const ct = scroll.getBoundingClientRect().top;
      return { delta: Math.abs(st - ct), scrolled: scroll.scrollTop };
    })()`) as { delta: number; scrolled: number };
    const pass = r.scrolled > 300 && r.delta <= 2;
    return { name: '', pass, detail: `stickyTop-containerTop=${r.delta.toFixed(1)} scrollTop=${r.scrolled}` };
  });

  await run('b2 windowing: below-fold tile is a BUSY ghost, hydrates on scroll (real WindowedTile in foreignObject)', '/b2-windowed.html', async (p) => {
    const ghost = await p.evaluate(`(() => { const g = document.querySelector('[data-mx-tile-ghost]'); return { present: !!g, busy: g && g.getAttribute('data-mx-busy'), content: !!document.getElementById('b2wcontent') }; })()`) as { present: boolean; busy: string | null; content: boolean };
    if (!ghost.present || ghost.busy !== 'true' || ghost.content) {
      return { name: '', pass: false, detail: `pre-scroll: ghost=${ghost.present} busy=${ghost.busy} content=${ghost.content}` };
    }
    await p.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await p.waitForFunction(`!!document.getElementById('b2wcontent')`, undefined, { timeout: 5000 });
    const after = await p.evaluate(`(() => ({ ghost: !!document.querySelector('[data-mx-tile-ghost]'), content: !!document.getElementById('b2wcontent') }))()`) as { ghost: boolean; content: boolean };
    return { name: '', pass: after.content && !after.ghost, detail: `post-scroll: content=${after.content} ghost=${after.ghost}` };
  });

  await run('b2 windowing: force-mount event hydrates the ghost without scrolling (capture contract)', '/b2-windowed.html', async (p) => {
    const pre = await p.evaluate(`!!document.querySelector('[data-mx-tile-ghost]')`) as boolean;
    if (!pre) return { name: '', pass: false, detail: 'no ghost before force event' };
    await p.evaluate(`document.dispatchEvent(new CustomEvent('mx-force-mount-tiles'))`);
    await p.waitForFunction(`!!document.getElementById('b2wcontent')`, undefined, { timeout: 5000 });
    return { name: '', pass: true, detail: 'hydrated on force event' };
  });

  await run('b2 portal over the surface: clickable, surface stays interactive, excluded from capture', '/b2-popover.html', async (p) => {
    await p.click('#b2pop');
    const tileBox = await p.locator('#b2tile').boundingBox();
    if (!tileBox) return { name: '', pass: false, detail: 'tile not found' };
    // Click the tile in an area the portal does not cover (bottom-right corner).
    await p.mouse.click(tileBox.x + tileBox.width - 20, tileBox.y + tileBox.height - 20);
    const st = await p.evaluate(`({ pop: window.__b2.state.popClicks, tile: window.__b2.state.tileClicks })`) as { pop: number; tile: number };
    const cap = await p.evaluate(`window.__b2.captureProbe([[22,160,133]])`) as { xml: string; found: boolean[] };
    const excluded = !cap.xml.includes('PORTAL_ONLY_TEXT');
    const pass = st.pop === 1 && st.tile === 1 && excluded && cap.found[0];
    return { name: '', pass, detail: `popClicks=${st.pop} tileClicks=${st.tile} portalExcluded=${excluded} tileInCapture=${cap.found[0]}` };
  });

  return results;
}
