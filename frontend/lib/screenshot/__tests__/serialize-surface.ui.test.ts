/**
 * Live-svg surface capture for MAIN-DOCUMENT views (Renderer_v2 Phase 4, Option B2): a dashboard's
 * grid renders inside `<svg data-mx-surface-svg><foreignObject>` in the main document, and capture
 * serializes THAT live svg (capture-is-the-renderer) instead of cloning the subtree into a fresh
 * wrapper. Differs from the story serializer (iframe, self-contained styles): styles here live in
 * the parent DOCUMENT's stylesheets, so they are collected exactly like the generic element path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SURFACE_SVG_ATTR,
  findSurfaceSvg,
  serializeSurfaceSvg,
} from '@/lib/screenshot/serialize-surface';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build a live surface: svg[data-mx-surface-svg] > foreignObject > root div, appended to body. */
function mountSurface(rootHtml: string, { width = 800, height = 400 } = {}): { host: HTMLElement; svg: SVGSVGElement; root: HTMLElement } {
  const host = document.createElement('div');
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute(SURFACE_SVG_ATTR, '');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const fo = document.createElementNS(SVG_NS, 'foreignObject');
  fo.setAttribute('width', '100%');
  fo.setAttribute('height', '100%');
  const root = document.createElement('div');
  root.innerHTML = rootHtml;
  fo.appendChild(root);
  svg.appendChild(fo);
  host.appendChild(svg);
  document.body.appendChild(host);
  return { host, svg, root };
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});

describe('findSurfaceSvg', () => {
  it('finds the surface svg inside an element, and null when absent', () => {
    const { host, svg } = mountSurface('<p>content</p>');
    expect(findSurfaceSvg(host)).toBe(svg);
    const bare = document.createElement('div');
    expect(findSurfaceSvg(bare)).toBeNull();
  });
});

describe('serializeSurfaceSvg', () => {
  it('serializes standalone: xmlns once, explicit size kept, DOCUMENT css inlined', async () => {
    const style = document.createElement('style');
    style.textContent = '.tile{background:teal}';
    document.head.appendChild(style);
    const { svg } = mountSurface('<div class="tile">Revenue</div>', { width: 640, height: 320 });
    const out = await serializeSurfaceSvg(svg);
    expect(out.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)!.length).toBe(1);
    expect(out).toMatch(/<svg[^>]*\swidth="640"/);
    expect(out).toMatch(/<svg[^>]*\sheight="320"/);
    expect(out).toMatch(/\.tile\s*\{\s*background:\s*teal;?\s*\}/);
    expect(out).toContain('Revenue');
  });

  it('stamps the cloned root with the color mode (post-6a: no chakra-theme stamp; live untouched)', async () => {
    const { svg, root } = mountSurface('<p>x</p>');
    const light = await serializeSurfaceSvg(svg);
    expect(light).toMatch(/class="[^"]*light/);
    expect(light).not.toContain('chakra-theme');
    document.documentElement.classList.add('dark');
    const dark = await serializeSurfaceSvg(svg);
    expect(dark).toMatch(/class="[^"]*dark/);
    expect(root.getAttribute('class') ?? '').not.toContain('dark');
  });

  it('bakes form state and drops transient portals, live DOM untouched', async () => {
    const { svg, root } = mountSurface(
      '<input id="i" type="text"><div data-scope="menu" data-part="positioner"><p>menu body</p></div>',
    );
    (root.querySelector('#i') as HTMLInputElement).value = 'typed';
    const out = await serializeSurfaceSvg(svg);
    expect(out).toContain('value="typed"');
    expect(out).not.toContain('menu body');
    expect(root.querySelector('[data-part="positioner"]')).toBeTruthy();
    expect((root.querySelector('#i') as HTMLElement).getAttribute('value')).toBeNull();
  });

  it('inlines <img> sources as data: URIs, leaving failures as-is', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      if (String(url).includes('ok.png')) {
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          arrayBuffer: async () => new Uint8Array([7]).buffer,
        } as unknown as Response;
      }
      throw new Error('blocked');
    }) as unknown as typeof fetch;
    const { svg } = mountSurface('<img src="https://cdn.example/ok.png"><img src="https://cdn.example/dead.png">');
    const out = await serializeSurfaceSvg(svg);
    expect(out).toContain('data:image/png;base64,');
    expect(out).toContain('https://cdn.example/dead.png');
  });
});
