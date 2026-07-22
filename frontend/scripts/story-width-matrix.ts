/**
 * Three-engine FLUID-WIDTH guard (Story_Design_V2 §4) — the permanent, real-browser regression net
 * for "the story lays out wider than the reader can see".
 *
 * WHY THIS EXISTS IN A BROWSER, NOT IN JSDOM
 * The svg surface is exactly as wide as it was TOLD (an <svg> never auto-sizes to its foreignObject
 * content). A fluid caller — StoryView renders a 100%-wide iframe while passing the LOGICAL canvas
 * width, 1280 — therefore lays the story out at 1280 inside whatever narrower box the reader has,
 * and the overflow is clipped SILENTLY: the fluid shim pins `overflow-x:hidden`, so there is not
 * even a scrollbar to notice. Worse, captures serialize that same live <svg>, so the agent's
 * screenshot shows content the reader cannot — a fidelity fork. Both properties are pure LAYOUT
 * facts; jsdom has no layout engine and can only pin the plumbing (which width reaches the surface,
 * in which order — components/views/shared/__tests__/story-fluid-width.ui.test.tsx). This file is
 * where "the story is not clipped" is actually guarded.
 *
 * WHAT IT DRIVES: the REAL modules, not a re-implementation — `mountStorySurface`,
 * `autoSizeStorySurface` (the sizing loop AND its ResizeObserver wiring, which is why the resize
 * step below is a real test of reactivity and not decoration), `STORY_FLUID_SHIM_CSS`,
 * `serializeStorySvg`, `svgToImage`. Only the iframe-document scaffolding around them is fixture
 * code, mirroring AgentHtml's build effect.
 *
 * Fixtures + checks are exported and run from scripts/capture-matrix.ts, so `npm run capture-matrix`
 * stays the single command for the whole browser matrix.
 */
import type { BrowserContext } from '@playwright/test';

/** StoryView's STORY_W: the logical canvas the agent authors against, and what AgentHtml mounts. */
const LOGICAL_W = 1280;

/** Container widths a real reader hits: phone, tablet, desktop-with-side-chat, full desktop. */
const WIDTHS = [390, 768, 1104, 1440];

/** Resize-reactivity case: first paint wide, then the side-chat opens and narrows the pane. */
const RESIZE_FROM = 1440;
const RESIZE_TO = 900;

/** Appended to the capture-matrix bundle entry: the real surface modules, on `window.__story`. */
export const WIDTH_BUNDLE_ENTRY = `
  import { mountStorySurface, autoSizeStorySurface, STORY_FLUID_SHIM_CSS } from '@/lib/story-surface';
  import { serializeStorySvg, svgToImage as storySvgToImage } from '@/lib/story-surface/serialize';
  (window as unknown as { __story: object }).__story = {
    mountStorySurface, autoSizeStorySurface, STORY_FLUID_SHIM_CSS, serializeStorySvg, storySvgToImage,
  };
`;

const PROSE = [
  'Revenue grew 14% quarter over quarter, with the strongest contribution coming from mid-market accounts in the northern region, where the new pricing tiers landed in the first week of the quarter.',
  'Churn stayed flat at 1.8% despite the pricing change, which is the single most encouraging number in this report: the accounts that repriced did not leave, they expanded, and the expansion came almost entirely from seats rather than from add-on modules.',
  'The enterprise segment is the one place where the story is less comfortable. Two of the five largest accounts pushed their renewals into next quarter, which pulls roughly 400k of recognised revenue across the boundary and makes the sequential comparison look softer than the underlying business actually is.',
  'Support load per account fell for the fourth consecutive quarter. The self-serve migration tooling shipped in April is the likeliest cause, and the ticket mix supports that reading: setup and import tickets are down sharply while everything else is roughly unchanged.',
  'Looking forward, the two numbers worth watching are seat expansion inside repriced accounts and the timing of the deferred enterprise renewals. Everything else in this report is either stable or moving in the expected direction.',
];

/**
 * TEXT-HEAVY story — reflow is the point. At 390px this wraps to several times the height it has at
 * 1440px, which is what makes the "measure height AFTER the width lands" ordering observable: a
 * height measured at the old, wider layout under-sizes the surface and clips the story vertically.
 */
const STORY_TEXT = `
  <style>
    .story { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px; box-sizing: border-box; color: #16202c; }
    .story h1 { font-size: 34px; line-height: 1.2; margin: 0 0 16px; }
    .story h2 { font-size: 22px; margin: 28px 0 10px; }
    .story p { font-size: 16px; line-height: 1.65; margin: 0 0 14px; }
  </style>
  <div class="story">
    <h1>Quarterly revenue narrative</h1>
    ${PROSE.map((p) => `<p>${p}</p>`).join('')}
    <h2>Segment detail</h2>
    ${PROSE.map((p) => `<p>${p}</p>`).join('')}
  </div>`;

/**
 * WIDE-CONTENT story — horizontal clipping is the point. Both wide blocks are shapes the agent
 * really authors: a table wider than any phone (inside the scroll wrapper a story author is
 * expected to use), and a chart embed with an authored px width, which exercises the REAL
 * `[data-question-id]` rule in STORY_FLUID_SHIM_CSS rather than a copy of it.
 */
const STORY_TABLE = `
  <style>
    .story { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px; box-sizing: border-box; color: #16202c; }
    .story h1 { font-size: 30px; margin: 0 0 16px; }
    .story p { font-size: 16px; line-height: 1.6; margin: 14px 0; }
    .scroller { width: 100%; overflow-x: auto; }
    table { border-collapse: collapse; width: 1100px; font-size: 14px; }
    th, td { border: 1px solid #c9d3de; padding: 6px 10px; text-align: left; white-space: nowrap; }
    th { background: #eef3f8; }
  </style>
  <div class="story">
    <h1>Top accounts</h1>
    <div class="scroller">
      <table>
        <thead><tr><th>Account</th><th>Region</th><th>Plan</th><th>Seats</th><th>ARR</th><th>Renewal</th></tr></thead>
        <tbody>
          ${Array.from({ length: 12 }, (_, i) => `<tr>
            <td>Account ${i + 1}</td><td>North</td><td>Growth</td><td>${40 + i * 7}</td><td>$${(120 + i * 13)}k</td><td>2026-0${(i % 9) + 1}-14</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div data-question-id="7" style="width:1100px;height:220px;background:#1478dc"></div>
    <p>${PROSE[0]}</p>
    <p>${PROSE[2]}</p>
  </div>`;

/**
 * In-page driver. Mirrors AgentHtml's build effect for the parts that affect LAYOUT — a fresh
 * same-origin iframe document, margin/overflow/min-height pinned the way a content-driven story
 * pins them (skip these and a classic scrollbar steals ~15px of body.clientWidth), the surface
 * mounted at the LOGICAL width, the story written into its root, the shim appended last — and then
 * hands the whole sizing contract to the real `autoSizeStorySurface`.
 */
const DRIVER = (storyHtml: string) => `
  const LOGICAL_W = ${LOGICAL_W};
  const STORY_HTML = ${JSON.stringify(storyHtml)};
  const container = document.getElementById('container');
  let surface, iframe, doc;

  const frame = () => new Promise(r => requestAnimationFrame(r));

  function build() {
    iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;border:0;display:block;color-scheme:normal;background:transparent';
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
    surface = window.__story.mountStorySurface(doc, 'svg', LOGICAL_W);
    surface.root.innerHTML = STORY_HTML;
    const shim = doc.createElement('style');
    shim.setAttribute('data-mx-fluid-shim', '');
    shim.textContent = window.__story.STORY_FLUID_SHIM_CSS;
    surface.root.appendChild(shim);
    window.__story.autoSizeStorySurface({ surface, iframe, doc, fluid: true });
  }

  // Poll to settle rather than sleeping: ResizeObserver delivery is asynchronous (after layout,
  // before paint), so a fixed sleep flakes. BOTH axes must hold still, not just width: a width
  // change resizes the surface, which fires the observer AGAIN a frame later with the reflowed
  // height, so a width-only settle could probe a stale height and fail a correct implementation.
  // Bails out after the deadline WITHOUT throwing — a surface that never reaches the container
  // width is precisely the failure the caller asserts on, and it must be reported with numbers,
  // not as a timeout.
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
  async function resizeTo(w) { container.style.width = w + 'px'; await settle(); }

  /** Everything an assertion needs: live geometry + the geometry of the CAPTURE of that same svg. */
  async function probe() {
    const rect = surface.root.getBoundingClientRect();
    const m = {
      container: container.clientWidth,
      iframeW: iframe.clientWidth,
      bodyW: doc.body.clientWidth,
      rootRectW: Math.round(rect.width * 100) / 100,
      rootScrollW: surface.root.scrollWidth,
      rootScrollH: surface.root.scrollHeight,
      svgW: Number(surface.svg.getAttribute('width')),
      svgH: Number(surface.svg.getAttribute('height')),
      iframeH: Math.round(iframe.getBoundingClientRect().height),
    };
    const xml = await window.__story.serializeStorySvg(surface.svg);
    const img = await window.__story.storySvgToImage(xml);
    m.capturedW = img.naturalWidth;
    m.capturedH = img.naturalHeight;
    m.ink = -1;
    if (m.capturedW > 0 && m.capturedH > 0) {
      const c = document.createElement('canvas');
      c.width = m.capturedW; c.height = m.capturedH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data; // THROWS on a tainted canvas
      let ink = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) ink++;
      m.ink = ink;
    }
    return m;
  }

  window.__drive = { mountAt, resizeTo, probe };
`;

const widthPage = (storyHtml: string) => `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0">
  <div id="container" style="width:1280px"></div>
  <script src="/bundle.js"></script>
  <script>${DRIVER(storyHtml)}</script>
</body></html>`;

export const WIDTH_FIXTURES: Record<string, string> = {
  '/width-text.html': widthPage(STORY_TEXT),
  '/width-table.html': widthPage(STORY_TABLE),
};

/** Live + captured geometry for one container width. */
interface Probe {
  container: number; iframeW: number; bodyW: number;
  rootRectW: number; rootScrollW: number; rootScrollH: number;
  svgW: number; svgH: number; iframeH: number;
  capturedW: number; capturedH: number; ink: number;
}

interface CheckResult { name: string; pass: boolean; detail?: string }

/** Sub-pixel tolerance: cross-engine rounding is ±1px, while the bug's gap is hundreds of px. */
const TOL = 1;

const nums = (m: Probe) =>
  `container=${m.container} iframe=${m.iframeW} body=${m.bodyW} rootRect=${m.rootRectW} ` +
  `rootScrollW=${m.rootScrollW} rootScrollH=${m.rootScrollH} svgAttr=${m.svgW}x${m.svgH} ` +
  `captured=${m.capturedW}x${m.capturedH} iframeH=${m.iframeH} ink=${m.ink}`;

/**
 * The four properties, asserted against ONE measured state. Every message carries the numbers that
 * produced it — a failure must read as a diagnosis, not as "expected true".
 */
function failures(at: string, m: Probe): string[] {
  const f: string[] = [];
  // (a) NO CLIP — the story must lay out at exactly the width the reader has.
  if (Math.abs(m.rootRectW - m.container) > TOL) {
    f.push(`${at}: story root lays out ${m.rootRectW}px wide in a ${m.container}px container (off by ${(m.rootRectW - m.container).toFixed(2)}px; svg width attr=${m.svgW}, iframe=${m.iframeW}, body=${m.bodyW})`);
  }
  if (m.rootScrollW > m.container + TOL) {
    f.push(`${at}: CLIPPED — root scrollWidth ${m.rootScrollW}px > container ${m.container}px, so ${m.rootScrollW - m.container}px of the story is unreachable (overflow-x is hidden: no scrollbar; svg width attr=${m.svgW})`);
  }
  // (b) NO FIDELITY FORK — the capture must be exactly the width the reader sees.
  if (Math.abs(m.capturedW - m.container) > TOL) {
    f.push(`${at}: FIDELITY FORK — capture is ${m.capturedW}px wide but the reader sees ${m.container}px (${m.capturedW - m.container}px of the agent's screenshot is content the reader cannot see; svg width attr=${m.svgW})`);
  }
  // (d) HEIGHT AFTER REFLOW — the capture must cover the content as reflowed at THIS width.
  if (m.capturedH < m.rootScrollH) {
    f.push(`${at}: VERTICALLY CLIPPED — capture is ${m.capturedH}px tall but the content reflowed to ${m.rootScrollH}px at ${m.container}px wide (${m.rootScrollH - m.capturedH}px cut off; height was measured before the width landed?)`);
  }
  if (m.ink === 0) {
    f.push(`${at}: capture is BLANK — no non-white pixels in ${m.capturedW}x${m.capturedH}`);
  }
  if (f.length) f.push(`${at}: [${nums(m)}]`);
  return f;
}

/**
 * Run the fluid-width guard for one engine. Every container width gets a FRESH page (that is what a
 * reader actually loads), plus one page that resizes after first paint.
 */
export async function runWidthChecks(ctx: BrowserContext, base: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const drive = async (url: string, script: string): Promise<Probe[]> => {
    const p = await ctx.newPage();
    try {
      await p.goto(base + url);
      await p.waitForFunction('!!window.__story && !!window.__drive');
      return await p.evaluate(`(async () => { ${script} })()`) as Probe[];
    } finally {
      await p.close();
    }
  };

  for (const [label, url] of [['text-heavy', '/width-text.html'], ['wide-table', '/width-table.html']] as const) {
    for (const w of WIDTHS) {
      const name = `fluid width ${w}px — ${label}: no clip, capture matches, height covers reflow`;
      try {
        const [m] = await drive(url, `await window.__drive.mountAt(${w}); return [await window.__drive.probe()];`);
        const f = failures(`${label}@${w}px`, m);
        results.push({ name, pass: f.length === 0, detail: f.join(' | ') });
      } catch (e) {
        results.push({ name, pass: false, detail: String(e) });
      }
    }

    // (c) RESIZE REACTIVITY — the regression a mount-time-only fix would miss. The surface must
    // track the container when it narrows AFTER first paint (side-chat toggle, window resize);
    // nothing rebuilds the document on a pane-width change, so the ResizeObserver inside
    // autoSizeStorySurface is the only thing that can fire.
    const name = `resize ${RESIZE_FROM}→${RESIZE_TO}px after first paint — ${label}: surface re-tracks the container`;
    try {
      const [before, after] = await drive(url, `
        await window.__drive.mountAt(${RESIZE_FROM});
        const before = await window.__drive.probe();
        await window.__drive.resizeTo(${RESIZE_TO});
        return [before, await window.__drive.probe()];
      `);
      const f = [...failures(`${label}@${RESIZE_FROM}px(first paint)`, before), ...failures(`${label}@${RESIZE_TO}px(after resize)`, after)];
      results.push({ name, pass: f.length === 0, detail: f.join(' | ') });
    } catch (e) {
      results.push({ name, pass: false, detail: String(e) });
    }
  }

  return results;
}
