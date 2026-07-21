/**
 * Headless-capture fidelity check (Story_Design_V2 §6c / §11 Phase 5).
 *
 * Captures ONE fixture story two ways and pixel-diffs the results:
 *  1. HEADLESS — through the REAL production seam `renderStoryToImage`
 *     (lib/headless-capture/index.server.ts → CaptureManager → Playwright backend), pointed at
 *     a local fixture server that serves the story page shape the backend expects
 *     (`/f/[id]` → `[data-file-id]` host → same-origin iframe → `svg[data-mx-story-svg]`).
 *  2. CLIENT — through the REAL client serialize path (`serializeStorySvg` + `svgToImage`
 *     from lib/story-surface/serialize, esbuild-bundled into the fixture page), rasterized
 *     onto a canvas exactly as lib/screenshot/capture.ts does.
 *
 * WHY HERMETIC (same pattern as scripts/capture-matrix.ts): the real `/f/[id]` route needs a
 * booted app + seeded DB + login; a self-contained fixture server exercises the same DOM /
 * selector / capture contract over the real modules with no dev server, so the check is fast
 * and deterministic. The Playwright backend screenshots the element while the client path
 * serializes it — this diff is precisely the serialize-path-parity guarantee the backend's
 * `page.screenshot` fallback defers to (see playwright-backend.server.ts header).
 *
 * EXPLICIT THRESHOLDS (recorded here per §11):
 *  - CHANNEL_TOLERANCE = 24 — per-channel delta below which a pixel counts as identical
 *    (absorbs antialiasing differences between direct render and SVG-rasterized render).
 *  - DIFF_RATIO_THRESHOLD = 0.01 — at most 1% of pixels may differ beyond the tolerance.
 *
 * Run: npm run capture-fidelity   (exits non-zero on failure)
 */
import { build } from 'esbuild';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import { renderStoryToImage, shutdownHeadlessCapture } from '@/lib/headless-capture/index.server';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 4621;
const FILE_ID = 777;
const WIDTH = 800;
const HEIGHT = 520;

const CHANNEL_TOLERANCE = 24;
const DIFF_RATIO_THRESHOLD = 0.01;

/**
 * The story-surface document: the exact shape lib/story-surface mounts —
 * `svg[data-mx-story-svg] > foreignObject > div[data-mx-story-root]` (XHTML-namespaced) —
 * with head styles so the serialize path exercises its style-cloning step. Content mixes the
 * §4 capture-relevant shapes: solid blocks, text, an inline SVG chart, absolute positioning.
 */
const STORY_FRAME = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { margin: 0; }
  .story { font-family: Arial, sans-serif; width: ${WIDTH}px; height: ${HEIGHT}px; background: #ffffff; box-sizing: border-box; padding: 24px; position: relative; }
  .story h1 { color: rgb(20, 40, 80); margin: 0 0 12px; }
  .tile { display: inline-block; width: 160px; height: 90px; border-radius: 8px; margin-right: 12px; }
  .tile.a { background: rgb(20, 120, 220); }
  .tile.b { background: rgb(230, 140, 20); }
  .badge { position: absolute; top: 24px; right: 24px; width: 80px; height: 28px; background: rgb(30, 160, 90); color: #fff; text-align: center; line-height: 28px; border-radius: 14px; }
</style>
</head>
<body>
<svg data-mx-story-svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" style="display:block">
  <foreignObject x="0" y="0" width="${WIDTH}" height="${HEIGHT}">
    <div xmlns="http://www.w3.org/1999/xhtml" data-mx-story-root>
      <div class="story">
        <h1>Fidelity fixture</h1>
        <div class="badge">LIVE</div>
        <div class="tile a"></div><div class="tile b"></div>
        <p>Deterministic story body for headless-vs-client capture parity.</p>
        <svg width="740" height="180" viewBox="0 0 740 180">
          <rect x="20" y="40" width="80" height="140" fill="rgb(20,120,220)"></rect>
          <rect x="120" y="90" width="80" height="90" fill="rgb(230,140,20)"></rect>
          <path d="M240 160 L400 60 L560 120 L720 30" stroke="rgb(120,40,200)" stroke-width="5" fill="none"></path>
        </svg>
      </div>
    </div>
  </foreignObject>
</svg>
<script src="/bundle.js"></script>
</body></html>`;

/** The outer page shaped like the app's /f/[id] story view: `[data-file-id]` host wrapping the surface iframe. */
const OUTER_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0">
  <div data-file-id="${FILE_ID}">
    <iframe src="/story-frame.html" style="display:block;border:0;width:${WIDTH}px;height:${HEIGHT}px"></iframe>
  </div>
</body></html>`;

function serve(bundleJs: string): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.url === `/f/${FILE_ID}`) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(OUTER_PAGE);
    } else if (req.url === '/story-frame.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(STORY_FRAME);
    } else if (req.url === '/bundle.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end(bundleJs);
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function main(): Promise<void> {
  // Bundle the REAL client serialize modules for the fixture page (matching capture-matrix).
  const bundle = await build({
    stdin: {
      contents: `
        import { serializeStorySvg, svgToImage } from '@/lib/story-surface/serialize';
        (window as unknown as { __fidelity: object }).__fidelity = { serializeStorySvg, svgToImage };
      `,
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    alias: { '@': ROOT },
  });
  const server = await serve(bundle.outputFiles[0].text);
  const baseUrl = `http://localhost:${PORT}`;

  try {
    // 1. HEADLESS — the real production seam end-to-end (env-gated; the npm script sets
    //    HEADLESS_CAPTURE=1 so the capability is on).
    const headless = await renderStoryToImage({ fileId: FILE_ID, baseUrl, width: WIDTH, format: 'png' });
    if (!headless.ok) {
      throw new Error(`renderStoryToImage failed: ${headless.reason} — ${headless.detail ?? ''}`);
    }
    const headlessPng = `data:image/png;base64,${headless.buffer.toString('base64')}`;

    // 2. CLIENT — the real serialize path inside the fixture page.
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: WIDTH + 100, height: HEIGHT + 100 }, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/story-frame.html`);
    await page.waitForFunction('!!window.__fidelity', undefined, { timeout: 10_000 });
    // String-evaluated (not a serialized closure): tsx's compiled helpers (__name) don't
    // exist inside the page, so the in-page code must be plain JS source — same pattern
    // as scripts/capture-matrix.ts.
    const clientPng = (await page.evaluate(`(async () => {
      const svg = document.querySelector('svg[data-mx-story-svg]');
      const xml = await window.__fidelity.serializeStorySvg(svg);
      const img = await window.__fidelity.svgToImage(xml);
      const box = svg.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(box.width);
      canvas.height = Math.round(box.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    })()`)) as string;

    // 3. DIFF — decode both PNGs in-page and count pixels differing beyond the tolerance.
    interface DiffResult { sizeMismatch: string | null; ratio: number; total: number; differing: number }
    const diff = (await page.evaluate(`(async () => {
      const tolerance = ${CHANNEL_TOLERANCE};
      const load = (src) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('png decode failed'));
        img.src = src;
      });
      const [imgA, imgB] = await Promise.all([load(${JSON.stringify(headlessPng)}), load(${JSON.stringify(clientPng)})]);
      if (imgA.naturalWidth !== imgB.naturalWidth || imgA.naturalHeight !== imgB.naturalHeight) {
        return { sizeMismatch: imgA.naturalWidth + 'x' + imgA.naturalHeight + ' vs ' + imgB.naturalWidth + 'x' + imgB.naturalHeight, ratio: 1, total: 0, differing: 0 };
      }
      const pixels = (img) => {
        const c = document.createElement('canvas');
        c.width = imgA.naturalWidth;
        c.height = imgA.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const pa = pixels(imgA);
      const pb = pixels(imgB);
      let differing = 0;
      const total = pa.length / 4;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.abs(pa[i] - pb[i]) > tolerance
          || Math.abs(pa[i + 1] - pb[i + 1]) > tolerance
          || Math.abs(pa[i + 2] - pb[i + 2]) > tolerance) {
          differing += 1;
        }
      }
      return { sizeMismatch: null, ratio: differing / total, total, differing };
    })()`)) as DiffResult;
    await browser.close();

    if (diff.sizeMismatch) {
      throw new Error(`capture dimensions diverge: ${diff.sizeMismatch}`);
    }
    const pct = (diff.ratio * 100).toFixed(3);
    console.log(
      `headless vs client-serialize: ${diff.differing}/${diff.total} pixels differ beyond ±${CHANNEL_TOLERANCE} (${pct}%), threshold ${DIFF_RATIO_THRESHOLD * 100}%`,
    );
    if (diff.ratio > DIFF_RATIO_THRESHOLD) {
      throw new Error(`pixel diff ${pct}% exceeds threshold ${DIFF_RATIO_THRESHOLD * 100}%`);
    }
    console.log('Fidelity check PASSED');
  } finally {
    await shutdownHeadlessCapture();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
