import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Renderer } from '@takumi-rs/core';
import { renderStoryRaster } from '@/lib/canvas-story/raster';
import { buildStoryNodeTree } from '@/lib/canvas-story/node-tree';

const MONO = readFileSync(join(__dirname, '../../../public/fonts/JetBrainsMono-Regular.ttf'));

// A story-shaped fixture exercising: bare-text blocks (must emit runs), a padded
// blockquote (run coordinates must include padding), and all four embed kinds.
const STORY_HTML = `
<div class="story">
  <h1 class="title">Quarterly Review</h1>
  <p class="lede">Revenue accelerated for the third consecutive quarter.</p>
  <blockquote class="pullquote">A quote with padding.</blockquote>
  <div data-question-id="1017"></div>
  <p>Inline <span data-number-inline="rev"></span> number and a
    <span data-param-name="region"></span> param.</p>
  <div data-question-inline="q2"></div>
</div>`;

const CSS = `
  .story { width: 800px; padding: 24px; background: #fff; color: #111; font-size: 16px; }
  .title { font-size: 32px; font-weight: 700; margin: 0 0 12px 0; }
  .lede { margin: 0 0 12px 0; }
  .pullquote { padding: 24px 16px; margin: 0 0 12px 0; border-left: 3px solid #111; }
  p, h1, blockquote { line-height: 1.5; }
`;

describe('canvas-story raster pipeline', () => {
  let renderer: Renderer;

  beforeAll(async () => {
    renderer = new Renderer();
    await renderer.registerFont(MONO.buffer.slice(MONO.byteOffset, MONO.byteOffset + MONO.byteLength));
  });

  it('renders a story to PNG bytes with sane dimensions', async () => {
    const result = await renderStoryRaster(renderer, {
      html: STORY_HTML, stylesheets: [CSS], width: 800, dpr: 2,
    });
    expect(result.png.length).toBeGreaterThan(1000);
    expect(result.width).toBe(800);
    expect(result.height).toBeGreaterThan(200);
  });

  it('emits text runs for bare-text blocks, in document order', async () => {
    const result = await renderStoryRaster(renderer, {
      html: STORY_HTML, stylesheets: [CSS], width: 800, dpr: 2,
    });
    const texts = result.runs.map(r => r.text.trim()).filter(Boolean);
    const title = texts.findIndex(t => t.includes('Quarterly Review'));
    const lede = texts.findIndex(t => t.includes('Revenue accelerated'));
    const quote = texts.findIndex(t => t.includes('A quote with padding'));
    expect(title).toBeGreaterThanOrEqual(0);
    expect(lede).toBeGreaterThan(title);
    expect(quote).toBeGreaterThan(lede);
  });

  it('offsets run coordinates by the node’s own padding (blockquote)', async () => {
    const result = await renderStoryRaster(renderer, {
      html: STORY_HTML, stylesheets: [CSS], width: 800, dpr: 2,
    });
    const lede = result.runs.find(r => r.text.includes('Revenue accelerated'))!;
    const quote = result.runs.find(r => r.text.includes('A quote with padding'))!;
    // .story padding-left 24; blockquote adds 16 more → quote text starts right of lede text
    expect(quote.x).toBeGreaterThanOrEqual(lede.x + 12);
    // and vertical padding (24) must push the run below the blockquote's border-box top
    const ledeBottom = lede.y + lede.h;
    expect(quote.y).toBeGreaterThan(ledeBottom + 12);
  });

  it('finds all four embed placeholder kinds with reserved sizes', async () => {
    const result = await renderStoryRaster(renderer, {
      html: STORY_HTML, stylesheets: [CSS], width: 800, dpr: 2,
    });
    const kinds = result.embeds.map(e => e.kind).sort();
    expect(kinds).toEqual(['number-inline', 'param', 'question', 'question-inline']);
    const q = result.embeds.find(e => e.kind === 'question')!;
    expect(q.ref).toBe('1017');
    expect(q.h).toBeGreaterThanOrEqual(300);
    expect(q.w).toBeGreaterThan(600);
    const p = result.embeds.find(e => e.kind === 'param')!;
    expect(p.ref).toBe('region');
    expect(p.h).toBeGreaterThanOrEqual(20);
  });

  it('decodes HTML entities in text', async () => {
    const result = await renderStoryRaster(renderer, {
      html: '<div class="story"><p>Fish &amp; chips&nbsp;now</p></div>',
      stylesheets: [CSS], width: 400, dpr: 1,
    });
    const all = result.runs.map(r => r.text).join(' ');
    expect(all).toContain('Fish & chips');
    expect(all).not.toContain('&amp;');
    expect(all).not.toContain('&nbsp;');
  });
});

describe('text-wrap neutralization (selection-boundary correctness)', () => {
  let renderer: Renderer;
  beforeAll(async () => {
    renderer = new Renderer();
    await renderer.registerFont(MONO.buffer.slice(MONO.byteOffset, MONO.byteOffset + MONO.byteLength));
  });

  // takumi's render honors text-wrap:balance but measure() wraps greedily, so
  // balanced headings would render one wrap point while the runs report another —
  // selection bands then cover the wrong words. The raster pipeline must force
  // greedy wrap in the CSS it feeds the engine so pixels and geometry agree.
  it('renders balanced headings with the SAME wrap the measured runs report', async () => {
    const html = '<div class="s"><h1>Mxfood closed 2025 with broad-based scale across orders, revenue, and active users.</h1></div>';
    const css = '.s{width:1104px;padding:48px;background:#fff} h1{font-size:56px;font-weight:800;line-height:1.1;margin:0;text-wrap:balance}';
    const raster = await renderStoryRaster(renderer, { html, stylesheets: [css], width: 1104, dpr: 1 });
    // Greedy wrap puts "revenue," on line 2; balanced render would push it to
    // line 3 while the runs still claim line 2. With neutralization both agree —
    // assert the run layout is the greedy one (which is what gets rendered too).
    const line2 = raster.runs.filter(r => r.y > raster.runs[0].y + 10 && r.y < raster.runs[0].y + 130);
    expect(line2.map(r => r.text).join('')).toContain('revenue,');
  });
});

describe('non-content nodes', () => {
  let renderer: Renderer;
  beforeAll(async () => {
    renderer = new Renderer();
    await renderer.registerFont(MONO.buffer.slice(MONO.byteOffset, MONO.byteOffset + MONO.byteLength));
  });

  it('emits no runs for title/style/script elements', async () => {
    const html = '<div class="s"><title>Phantom Heading Text</title><script>let x=1</scr' + 'ipt><p>Real content.</p></div>';
    const raster = await renderStoryRaster(renderer, { html, stylesheets: ['.s{width:400px;background:#fff}'], width: 400, dpr: 1 });
    const texts = raster.runs.map(r => r.text).join(' ');
    expect(texts).toContain('Real content.');
    expect(texts).not.toContain('Phantom');
    expect(texts).not.toContain('x=1');
  });
});

describe('buildStoryNodeTree', () => {
  it('wraps bare-text blocks so they emit runs and keeps embed attrs', () => {
    const { node } = buildStoryNodeTree('<div><p>Hello</p><div data-question-id="7"></div></div>');
    // wrapped paragraph: container with a text child
    const json = JSON.stringify(node);
    expect(json).toContain('"data-question-id"');
    expect(json).toContain('Hello');
  });
});

describe('resolveContainerQueries', () => {
  it('unwraps matching blocks scoped to container DESCENDANTS and drops non-matching ones', async () => {
    const { resolveContainerQueries } = await import('@/lib/canvas-story/resolve-container-queries');
    const css = '.a{color:red}@container (min-width: 672px){.b{display:grid}}@container (width >= 100rem){.c{color:blue}}';
    const resolved = resolveContainerQueries(css, 1280);
    // @container matches an ANCESTOR container, so unwrapped rules must not hit
    // the container element itself — only its descendants.
    expect(resolved).toContain('.\\@container .b{display:grid}');
    expect(resolved).not.toContain('.c');
    expect(resolved).toContain('.a{color:red}');
  });

  it('resolves Tailwind NESTED form (selector outside, @container inside) with descendant scoping', async () => {
    const { resolveContainerQueries } = await import('@/lib/canvas-story/resolve-container-queries');
    const css = '.\\@2xl\\:px-12 {\n  @container (width >= 42rem) {\n    padding-inline: 48px;\n  }\n}';
    const resolved = resolveContainerQueries(css, 1104);
    expect(resolved.replace(/\s+/g, '')).toContain('.\\@container.\\@2xl\\:px-12{padding-inline:48px');
    expect(resolveContainerQueries(css, 400).replace(/\s+/g, '')).not.toContain('padding-inline');
  });

  it('nested-form container variants do not pad the container element itself', async () => {
    const renderer = new Renderer();
    await renderer.registerFont(MONO.buffer.slice(MONO.byteOffset, MONO.byteOffset + MONO.byteLength));
    // Tailwind v4 nested emission, as stored in real compiledCss documents.
    const css = '.root{padding-left:24px;background:#fff;color:#111;font-size:16px}' +
      '.p12x{ @container (width >= 42rem){ padding-left:48px; } }';
    const rootHtml = '<div class="root p12x @container"><p>Anchored text</p></div>';
    const rootRaster = await renderStoryRaster(renderer, { html: rootHtml, stylesheets: [css], width: 800, dpr: 1 });
    expect(rootRaster.runs.find(r => r.text.includes('Anchored'))!.x).toBeCloseTo(24, 0);
    const nestedHtml = '<div class="root @container"><section class="p12x"><p>Nested text</p></section></div>';
    const nestedRaster = await renderStoryRaster(renderer, { html: nestedHtml, stylesheets: [css], width: 800, dpr: 1 });
    expect(nestedRaster.runs.find(r => r.text.includes('Nested'))!.x).toBeCloseTo(72, 0);
  });

  it('container-variant rules do not apply to the container element itself (root padding)', async () => {
    const renderer = new Renderer();
    await renderer.registerFont(MONO.buffer.slice(MONO.byteOffset, MONO.byteOffset + MONO.byteLength));
    // Mirrors the story root: `px-6 @2xl:px-12` ON the @container element. In the
    // DOM the @2xl rule never matches (no ancestor container), so padding stays 24.
    const css = '.root{padding-left:24px;background:#fff;color:#111;font-size:16px}' +
      '@container (min-width: 672px){.p12{padding-left:48px}}';
    const html = '<div class="root p12 @container"><p>Anchored text</p></div>';
    const raster = await renderStoryRaster(renderer, { html, stylesheets: [css], width: 800, dpr: 1 });
    const run = raster.runs.find(r => r.text.includes('Anchored'));
    expect(run!.x).toBeCloseTo(24, 0);
  });

  it('container-variant rules DO apply to descendants of the container', async () => {
    const renderer = new Renderer();
    await renderer.registerFont(MONO.buffer.slice(MONO.byteOffset, MONO.byteOffset + MONO.byteLength));
    const css = '.root{padding-left:24px;background:#fff;color:#111;font-size:16px}' +
      '@container (min-width: 672px){.p12{padding-left:48px}}';
    const html = '<div class="root @container"><section class="p12"><p>Nested text</p></section></div>';
    const raster = await renderStoryRaster(renderer, { html, stylesheets: [css], width: 800, dpr: 1 });
    const run = raster.runs.find(r => r.text.includes('Nested'));
    expect(run!.x).toBeCloseTo(72, 0); // 24 (root) + 48 (section, @container rule applied)
  });
});

describe('list markers', () => {
  it('injects bullet markers into ul items so lists match the DOM', async () => {
    const renderer = new Renderer();
    await renderer.registerFont(MONO.buffer.slice(MONO.byteOffset, MONO.byteOffset + MONO.byteLength));
    const result = await renderStoryRaster(renderer, {
      html: '<div class="story"><ul><li>alpha point</li><li>beta point</li></ul></div>',
      stylesheets: ['.story{padding:16px;background:#fff;color:#111;font-size:16px}'],
      width: 400, dpr: 1,
    });
    const texts = result.runs.map(r => r.text).join('|');
    expect(texts).toContain('• alpha point');
    expect(texts).toContain('• beta point');
  });
});
