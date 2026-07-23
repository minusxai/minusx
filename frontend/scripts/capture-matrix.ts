/**
 * Three-engine browser matrix (Story_Design_V2 §4/§11 Phase 2) — the gate for snapdom removal, and
 * the home of every property that only a REAL layout engine can assert. Two suites run here:
 *  1. the CAPTURE matrix (below) — serialize → data: URL → <img> → canvas, on every fixture shape;
 *  2. the FLUID-WIDTH guard (scripts/story-width-matrix.ts) — the story must lay out at the width
 *     the reader actually has, at first paint and after a resize, and the capture must match it.
 * Both run under `npm run capture-matrix`; the process exits non-zero if either fails.
 *
 * Drives the REAL serialization-capture modules (lib/screenshot/serialize-element.ts,
 * lib/story-surface/serialize.ts svgToImage, lib/data/story/banned-css.ts), esbuild-bundled and
 * loaded into self-contained HTML fixtures served from a local HTTP server, on Chromium, WebKit
 * and Firefox. Fixtures exercise the same DOM/stylesheet shapes as the app (Chakra-like CSS-var
 * sheets, fixed/sticky chrome, SVG charts, form state) — no dev server needed, so the matrix is
 * hermetic and fast.
 *
 * Every fixture rasterizes through the full pipeline (serialize → percent-encoded data: URL →
 * <img> → canvas) and then calls getImageData — which THROWS on a tainted canvas — so "untainted"
 * is asserted structurally on every single check.
 *
 * Run: npm run capture-matrix   (exits non-zero on any failure)
 */
import { build } from 'esbuild';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, webkit, firefox, type BrowserType } from '@playwright/test';
import { WIDTH_BUNDLE_ENTRY, WIDTH_FIXTURES, runWidthChecks } from './story-width-matrix';
import { B2_BUNDLE_ENTRY, B2_FIXTURES, runB2Checks } from './b2-surface-matrix';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAIN_PORT = 4611;
const CROSS_PORT = 4612;

// Solid-red SVG image (served as the external image fixture — deterministic pixels, any mime
// exercises the same fetch→data:-URI inlining path).
const RED_IMG = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="rgb(255,0,0)"/></svg>';

/** Common fixture page shell: loads the bundled capture modules, hosts the fixture markup. */
const page = (body: string, headExtra = '') => `<!doctype html>
<html><head><meta charset="utf-8">${headExtra}</head>
<body style="margin:0">${body}<script src="/bundle.js"></script></body></html>`;

const FIXTURES: Record<string, string> = {
  '/images.html': page(`
    <div id="target" style="width:200px;height:100px;background:#ffffff">
      <img id="ok" src="http://localhost:${CROSS_PORT}/red.svg" width="60" height="60" style="display:block">
      <img id="dead" src="http://localhost:${CROSS_PORT}/missing-404.png" width="10" height="10">
      <p>after images</p>
    </div>`),
  '/fonts.html': page(
    `<div id="target" style="width:200px;height:80px;background:#ffffff"><p style="font-family:CrossFont,serif">cross-origin font text</p></div>`,
    `<link rel="stylesheet" href="http://localhost:${CROSS_PORT}/font.css">`,
  ),
  '/appsheet.html': page(`
    <div id="target" class="page">
      <div class="card"><span class="accent">styled</span></div>
    </div>`, `
    <style>
      :root { --brand: rgb(20, 120, 220); --radius: 8px; }
      .page { width: 300px; height: 150px; background: #ffffff; }
      .card { width: 200px; height: 100px; background: var(--brand); border-radius: var(--radius); }
      .accent { color: #ffffff; font-weight: 600; }
      @media (min-width: 100px) { .card { margin: 10px; } }
    </style>`),
  '/chrome.html': page(`
    <div id="target" style="width:300px;background:#ffffff">
      <header style="position:fixed;top:0;left:0;width:300px;height:40px;background:rgb(200,30,30)">fixed header</header>
      <nav style="position:sticky;top:0;width:300px;height:30px;background:rgb(30,30,200)">sticky nav</nav>
      <main style="height:200px">
        <p>body content</p>
        <div id="deep" style="margin-top:120px;width:300px;height:40px;background:rgb(30,180,60)">deep content</div>
      </main>
    </div>`),
  '/svgchart.html': page(`
    <div id="target" style="width:220px;height:120px;background:#ffffff">
      <svg width="200" height="100" viewBox="0 0 200 100">
        <rect x="10" y="20" width="40" height="80" fill="rgb(230,140,20)"></rect>
        <rect x="60" y="50" width="40" height="50" fill="rgb(20,120,220)"></rect>
        <path d="M110 90 L150 30 L190 60" stroke="rgb(120,40,200)" stroke-width="4" fill="none"></path>
      </svg>
    </div>`),
  // Large-dataset chart fixture: Vega's SVG renderer emits plain inline SVG (paths/rects/text),
  // so a generated 5,000-point scatter + dense line reproduces its capture-relevant shape at scale
  // without bundling Vega itself. Guards serialize+rasterize throughput on big charts.
  '/bigchart.html': page(`
    <div id="target" style="width:800px;height:420px;background:#ffffff">
      <svg id="chart" width="780" height="400" viewBox="0 0 780 400"></svg>
    </div>
    <script>
      (function () {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.getElementById('chart');
        let d = 'M';
        for (let i = 0; i < 2000; i++) {
          d += (i * 0.39).toFixed(1) + ' ' + (200 + Math.sin(i / 30) * 150).toFixed(1) + ' L';
        }
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d.slice(0, -2));
        path.setAttribute('stroke', 'rgb(20,120,220)');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
        for (let i = 0; i < 3000; i++) {
          const c = document.createElementNS(NS, 'circle');
          c.setAttribute('cx', String((i * 173) % 780));
          c.setAttribute('cy', String((i * 89) % 400));
          c.setAttribute('r', '1.5');
          c.setAttribute('fill', 'rgb(230,140,20)');
          svg.appendChild(c);
        }
      })();
    </script>`),
  // Post-6a topology: content styles key off the COLOR-MODE class + [data-mx-theme-host]
  // (`.dark [data-mx-theme-host] { --t: … }`). A standalone serialized SVG has no <html>, so
  // without the mode stamp on the clone wrapper the dark chain collapses and dark captures
  // rasterize with light (or no) token values.
  '/modevars.html': page(`
    <div id="target" style="width:200px;height:100px;background:#ffffff">
      <div class="tile" style="width:120px;height:60px"></div>
    </div>`, `
    <style id="mode-pattern">
      [data-mx-theme-host] { --tile-bg: rgb(240, 243, 246); }
      .dark [data-mx-theme-host] { --tile-bg: rgb(20, 24, 28); }
      .tile { background: var(--tile-bg); }
    </style>`),
  '/form.html': page(`
    <div id="target" style="width:260px;height:120px;background:#ffffff">
      <input id="txt" type="text" style="width:200px">
      <textarea id="ta"></textarea>
      <input id="cb" type="checkbox">
    </div>`),
  '/banned.html': page(`
    <div id="target" style="width:200px;height:100px;background:#ffffff">
      <style id="storycss">
        @import url('http://localhost:${CROSS_PORT}/font.css');
        .hero { position: fixed; background: url(http://localhost:${CROSS_PORT}/red.svg); color: rgb(10,10,10); }
        .keep { background: rgb(240, 200, 40); }
      </style>
      <div class="keep" style="width:120px;height:60px">kept</div>
    </div>`),
};

/** Capture + fluid-width + B2 dashboard-surface fixtures, served from the one origin. */
const ALL_FIXTURES: Record<string, string> = { ...FIXTURES, ...WIDTH_FIXTURES, ...B2_FIXTURES };

function serve(port: number, handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

interface CheckResult { name: string; pass: boolean; detail?: string }

/** In-page helpers, stringified into every fixture evaluate call. */
const PAGE_HELPERS = `
  async function rasterize(el, opts) {
    const xml = await window.__matrix.serializeElementToSvg(el, opts || {});
    const img = await window.__matrix.svgToImage(xml);
    const w = img.naturalWidth || el.offsetWidth, h = img.naturalHeight || el.offsetHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data; // THROWS if tainted
    return { xml, data, w, h };
  }
  function hasColor(px, w, h, r, g, b, tol) {
    tol = tol == null ? 40 : tol;
    for (let i = 0; i < px.length; i += 4) {
      if (Math.abs(px[i] - r) <= tol && Math.abs(px[i+1] - g) <= tol && Math.abs(px[i+2] - b) <= tol) return true;
    }
    return false;
  }
  function colorAt(px, w, x, y) { const i = (y * w + x) * 4; return [px[i], px[i+1], px[i+2]]; }
`;

async function runEngine(browserType: BrowserType, base: string): Promise<CheckResult[]> {
  const browser = await browserType.launch();
  const ctx = await browser.newContext();
  const results: CheckResult[] = [];
  const check = async (name: string, url: string, fn: string) => {
    const p = await ctx.newPage();
    try {
      await p.goto(base + url);
      await p.waitForFunction('!!window.__matrix');
      const r = await p.evaluate(`(async () => { ${PAGE_HELPERS} return await (${fn})(); })()`) as CheckResult;
      results.push({ ...r, name });
    } catch (e) {
      results.push({ name, pass: false, detail: String(e) });
    } finally {
      await p.close();
    }
  };

  await check('external images inline-or-skip, untainted', '/images.html', `async () => {
    const { xml, data, w, h } = await rasterize(document.getElementById('target'));
    const inlined = xml.includes('data:image/svg');           // CORS-fetchable image inlined
    const deadKept = xml.includes('missing-404.png');         // dead image left as-is (skip, no taint)
    const redRendered = hasColor(data, w, h, 255, 0, 0);
    return { pass: inlined && deadKept && redRendered,
      detail: 'inlined=' + inlined + ' deadKept=' + deadKept + ' red=' + redRendered };
  }`);

  await check('cross-origin font stylesheet skipped gracefully, untainted', '/fonts.html', `async () => {
    const { xml, data, w, h } = await rasterize(document.getElementById('target'));
    // The cross-origin sheet is unreadable: its rules must not appear, text still renders (fallback font).
    const leaked = xml.includes('CrossFontLeak');
    let textPx = 0;
    for (let i = 0; i < data.length; i += 4) { if (data[i] < 200) textPx++; }
    return { pass: !leaked && textPx > 20, detail: 'leaked=' + leaked + ' textPx=' + textPx };
  }`);

  await check('full-app-stylesheet page styled (CSS vars + classes)', '/appsheet.html', `async () => {
    const { xml, data, w, h } = await rasterize(document.getElementById('target'));
    const brand = hasColor(data, w, h, 20, 120, 220);
    const widthOk = /<svg[^>]*\\swidth="300"/.test(xml) && /<svg[^>]*\\sheight="150"/.test(xml);
    return { pass: brand && widthOk, detail: 'brand=' + brand + ' explicitSize=' + widthOk };
  }`);

  await check('fixed/sticky chrome renders in document flow, content complete', '/chrome.html', `async () => {
    const { data, w, h } = await rasterize(document.getElementById('target'));
    // §4 expected behavior: the fixed header appears at its document-flow position (top of the
    // capture), sticky nav below it, and ALL content is present (deep content near the bottom).
    const headerAtTop = hasColor(data.slice(0, w * 45 * 4), w, 45, 200, 30, 30);
    const stickyPresent = hasColor(data, w, h, 30, 30, 200);
    const deepPresent = hasColor(data, w, h, 30, 180, 60);
    return { pass: headerAtTop && stickyPresent && deepPresent,
      detail: 'headerAtTop=' + headerAtTop + ' sticky=' + stickyPresent + ' deep=' + deepPresent };
  }`);

  await check('inline SVG chart pixels present', '/svgchart.html', `async () => {
    const { data, w, h } = await rasterize(document.getElementById('target'));
    const bars = hasColor(data, w, h, 230, 140, 20) && hasColor(data, w, h, 20, 120, 220);
    const line = hasColor(data, w, h, 120, 40, 200);
    return { pass: bars && line, detail: 'bars=' + bars + ' line=' + line };
  }`);

  await check('large-dataset SVG chart (perf) captures complete within budget', '/bigchart.html', `async () => {
    const t0 = performance.now();
    const { data, w, h } = await rasterize(document.getElementById('target'));
    const ms = performance.now() - t0;
    const line = hasColor(data, w, h, 20, 120, 220);
    const points = hasColor(data, w, h, 230, 140, 20);
    return { pass: line && points && ms < 10000,
      detail: 'line=' + line + ' points=' + points + ' ms=' + Math.round(ms) };
  }`);

  await check('mode-scoped theme-host tokens resolve — element capture, light AND dark', '/modevars.html', `async () => {
    // Light: the wrapper's theme host makes [data-mx-theme-host] match.
    const light = await rasterize(document.getElementById('target'));
    // colorAt, not hasColor: the default tolerance (40) would accept the white fallback.
    const lp = colorAt(light.data, light.w, 30, 30);
    const lightOk = Math.abs(lp[0] - 240) <= 5 && Math.abs(lp[1] - 243) <= 5 && Math.abs(lp[2] - 246) <= 5;
    // Dark: the clone wrapper must carry the mode class so the .dark theme-host block matches.
    document.documentElement.classList.add('dark');
    const dark = await rasterize(document.getElementById('target'));
    document.documentElement.classList.remove('dark');
    const dp = colorAt(dark.data, dark.w, 30, 30);
    const darkOk = Math.abs(dp[0] - 20) <= 5 && Math.abs(dp[1] - 24) <= 5 && Math.abs(dp[2] - 28) <= 5;
    return { pass: lightOk && darkOk, detail: 'light=' + lp.join(',') + ' dark=' + dp.join(',') };
  }`);

  await check('mode class survives the story-surface clone (dark rules resolve)', '/modevars.html', `async () => {
    // Story path: styles live IN-ROOT (self-contained doc); the serializer clones the live <svg>
    // and must stamp the current color-mode class on the cloned story root.
    document.documentElement.classList.add('dark');
    const s = window.__story.mountStorySurface(document, 'svg', 200);
    const style = document.createElement('style');
    // In-root topology: the story root IS the host-equivalent scope.
    style.textContent = '.tile { background: rgb(240,243,246); } .dark .tile { background: rgb(20,24,28); }';
    s.root.appendChild(style);
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.setAttribute('style', 'width:120px;height:60px');
    s.root.appendChild(tile);
    s.applyHeight(100);
    const xml = await window.__story.serializeStorySvg(document.querySelector('svg[data-mx-story-svg]'));
    document.documentElement.classList.remove('dark');
    const img = await window.__story.storySvgToImage(xml);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data; // THROWS if tainted
    const px = colorAt(data, c.width, 30, 30);
    const pass = Math.abs(px[0] - 20) <= 5 && Math.abs(px[1] - 24) <= 5 && Math.abs(px[2] - 28) <= 5;
    return { pass, detail: 'tilePx=' + px.join(',') + ' (want 20,24,28)' };
  }`);

  await check('form-control state stamped into the capture', '/form.html', `async () => {
    document.getElementById('txt').value = 'typed-into-input';
    document.getElementById('ta').value = 'typed-into-textarea';
    document.getElementById('cb').checked = true;
    const { xml, data } = await rasterize(document.getElementById('target'));
    const v = xml.includes('value="typed-into-input"');
    const ta = xml.includes('typed-into-textarea');
    const cb = xml.includes('checked');
    return { pass: v && ta && cb, detail: 'value=' + v + ' textarea=' + ta + ' checked=' + cb };
  }`);

  await check('banned CSS stripped → capture untainted, siblings survive', '/banned.html', `async () => {
    // Sanitize the authored story <style> exactly as the save path does, then capture.
    const styleEl = document.getElementById('storycss');
    styleEl.textContent = window.__matrix.sanitizeCssText(styleEl.textContent);
    const cleaned = styleEl.textContent;
    const { xml, data, w, h } = await rasterize(document.getElementById('target'));
    const noImport = !cleaned.includes('@import');
    const noExternal = !cleaned.includes('http://localhost:${CROSS_PORT}');
    const noFixed = !/position:\\s*fixed/.test(cleaned);
    const keptRendered = hasColor(data, w, h, 240, 200, 40);
    return { pass: noImport && noExternal && noFixed && keptRendered,
      detail: 'noImport=' + noImport + ' noExternal=' + noExternal + ' noFixed=' + noFixed + ' kept=' + keptRendered };
  }`);

  // The fluid-width guard and the B2 dashboard-surface suite run on the same context/engine
  // (their fixtures are served from the same map and drive the same bundle).
  results.push(...await runWidthChecks(ctx, base));
  results.push(...await runB2Checks(ctx, base));

  await browser.close();
  return results;
}

async function main(): Promise<void> {
  // Bundle the REAL modules for the browser (alias @ → repo root, matching tsconfig paths).
  const bundle = await build({
    stdin: {
      contents: `
        import { serializeElementToSvg } from '@/lib/screenshot/serialize-element';
        import { svgToImage } from '@/lib/story-surface/serialize';
        import { sanitizeCssText } from '@/lib/data/story/banned-css';
        (window as unknown as { __matrix: object }).__matrix = { serializeElementToSvg, svgToImage, sanitizeCssText };
        ${WIDTH_BUNDLE_ENTRY}
        ${B2_BUNDLE_ENTRY}
      `,
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { '@': ROOT },
  });
  const bundleJs = bundle.outputFiles[0].text;

  const main_ = await serve(MAIN_PORT, (req, res) => {
    if (req.url === '/bundle.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end(bundleJs);
      return;
    }
    const fixture = ALL_FIXTURES[req.url ?? ''];
    if (fixture) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(fixture);
      return;
    }
    res.writeHead(404).end();
  });
  const cross = await serve(CROSS_PORT, (req, res) => {
    if (req.url === '/red.svg') {
      // CORS-enabled so fetch-inlining succeeds from the main origin.
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' });
      res.end(RED_IMG);
      return;
    }
    if (req.url === '/font.css') {
      // NO CORS header: the link sheet is readable by the browser but its cssRules are
      // cross-origin-blocked — collectDocumentCss must skip it without throwing.
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end('.CrossFontLeak{color:red}@font-face{font-family:CrossFont;src:url(/missing.woff2)}');
      return;
    }
    res.writeHead(404).end();
  });

  const engines: Array<[string, BrowserType]> = [
    ['chromium', chromium],
    ['webkit', webkit],
    ['firefox', firefox],
  ];
  let failed = 0;
  for (const [name, type] of engines) {
    const results = await runEngine(type, `http://localhost:${MAIN_PORT}`);
    console.log(`\n=== ${name} ===`);
    for (const r of results) {
      console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  — ${r.detail ?? ''}`}`);
      if (!r.pass) failed++;
    }
  }
  main_.close();
  cross.close();
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll checks passed on chromium + webkit + firefox');
}

main().catch((e) => { console.error(e); process.exit(1); });
