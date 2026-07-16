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
  it('unwraps matching blocks and drops non-matching ones at the raster width', async () => {
    const { resolveContainerQueries } = await import('@/lib/canvas-story/resolve-container-queries');
    const css = '.a{color:red}@container (min-width: 672px){.b{display:grid}}@container (width >= 100rem){.c{color:blue}}';
    const resolved = resolveContainerQueries(css, 1280);
    expect(resolved).toContain('.b{display:grid}');
    expect(resolved).not.toContain('.c');
    expect(resolved).toContain('.a{color:red}');
  });
});
