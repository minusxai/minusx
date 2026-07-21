/**
 * Serializing an SVG story surface must produce a SELF-CONTAINED SVG, because an <img>-rendered SVG
 * has no parent document and no network: head styles must be cloned in, font files inlined as data:
 * URLs, and scroll offsets baked into the clone (XMLSerializer drops scrollLeft — the horizontally
 * scrolled table would otherwise capture reset to column 1).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  inlineFontUrls, applyScrollOffsets, collectSurfaceCss, clearFontDataUrlCache,
  stampFormValues, serializeStorySvg, svgToImage,
} from '@/lib/story-surface/serialize';
import { clearStoryFontCache } from '@/lib/html/resolve-story-fonts';

beforeEach(() => {
  clearStoryFontCache();
  clearFontDataUrlCache(); // font data: URLs are cached across captures — isolate each test
  vi.restoreAllMocks();
});

const fakeFontFetch = () => {
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.endsWith('.woff2')) {
      return {
        ok: true,
        headers: { get: () => 'font/woff2' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response;
    }
    return { ok: true, text: async () => '@font-face{font-family:X;src:url(https://cdn/x.woff2)}' } as unknown as Response;
  }) as unknown as typeof fetch;
};

describe('inlineFontUrls', () => {
  it('rewrites remote font urls to data: URLs (they cannot load in an <img>-rendered SVG)', async () => {
    fakeFontFetch();
    const out = await inlineFontUrls('@font-face{font-family:X;src:url(https://cdn/x.woff2) format("woff2")}');
    expect(out).toContain('data:font/woff2;base64,');
    expect(out).not.toContain('https://cdn/x.woff2');
  });

  it('leaves css without remote urls untouched', async () => {
    const css = '.a{color:red}';
    expect(await inlineFontUrls(css)).toBe(css);
  });

  it('keeps the original url when the font fetch fails (font falls back; capture still works)', async () => {
    global.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const css = '@font-face{src:url(https://cdn/y.woff2)}';
    expect(await inlineFontUrls(css)).toBe(css);
  });

  it('fetches each unique font file once even when referenced repeatedly', async () => {
    fakeFontFetch();
    await inlineFontUrls('a{src:url(https://cdn/x.woff2)} b{src:url(https://cdn/x.woff2)}');
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((c) => String(c[0]).endsWith('.woff2'));
    expect(calls.length).toBe(1);
  });
});

describe('collectSurfaceCss', () => {
  it('includes the head styles (app mirror + tailwind) which live outside the svg subtree', async () => {
    fakeFontFetch();
    const doc = document.implementation.createHTMLDocument('t');
    const s = doc.createElement('style');
    s.textContent = '.mirrored{color:tomato}';
    doc.head.appendChild(s);
    const css = await collectSurfaceCss(doc);
    expect(css).toContain('.mirrored{color:tomato}');
  });
});

describe('applyScrollOffsets', () => {
  const makeTree = (scrollLeft: number) => {
    const doc = document.implementation.createHTMLDocument('t');
    const live = doc.createElement('div');
    live.innerHTML = '<div id="scroller"><table id="t"></table></div>';
    const scroller = live.querySelector('#scroller') as HTMLElement;
    Object.defineProperty(scroller, 'scrollLeft', { value: scrollLeft, configurable: true });
    const clone = live.cloneNode(true) as HTMLElement;
    return { live, clone };
  };

  it('bakes a horizontal scroll offset into the clone as a transform', () => {
    const { live, clone } = makeTree(260);
    applyScrollOffsets(live, clone);
    const table = clone.querySelector('#t') as HTMLElement;
    expect(table.style.transform).toBe('translate(-260px, 0px)');
    expect((clone.querySelector('#scroller') as HTMLElement).style.overflow).toBe('hidden');
  });

  it('leaves unscrolled content alone (no stray transforms)', () => {
    const { live, clone } = makeTree(0);
    applyScrollOffsets(live, clone);
    expect((clone.querySelector('#t') as HTMLElement).style.transform).toBe('');
  });
});

describe('stampFormValues — form state is DOM properties, which XMLSerializer drops', () => {
  const makeForms = () => {
    const doc = document.implementation.createHTMLDocument('t');
    const live = doc.createElement('div');
    live.innerHTML = '<input id="i" type="text"><textarea id="ta"></textarea>'
      + '<input id="cb" type="checkbox"><select id="s"><option value="a">a</option><option value="b">b</option></select>';
    return { doc, live };
  };

  it('stamps typed input values and textarea text into the clone as serializable markup', () => {
    const { live } = makeForms();
    (live.querySelector('#i') as HTMLInputElement).value = 'typed';
    (live.querySelector('#ta') as HTMLTextAreaElement).value = 'notes';
    const clone = live.cloneNode(true) as HTMLElement;
    stampFormValues(live, clone);
    expect((clone.querySelector('#i') as HTMLElement).getAttribute('value')).toBe('typed');
    expect((clone.querySelector('#ta') as HTMLElement).textContent).toBe('notes');
  });

  it('stamps checkbox checked state and select selection', () => {
    const { live } = makeForms();
    (live.querySelector('#cb') as HTMLInputElement).checked = true;
    (live.querySelector('#s') as HTMLSelectElement).value = 'b';
    const clone = live.cloneNode(true) as HTMLElement;
    stampFormValues(live, clone);
    expect((clone.querySelector('#cb') as HTMLElement).hasAttribute('checked')).toBe(true);
    const opts = clone.querySelectorAll('#s option');
    expect((opts[1] as HTMLElement).hasAttribute('selected')).toBe(true);
    expect((opts[0] as HTMLElement).hasAttribute('selected')).toBe(false);
  });
});

describe('serializeStorySvg — self-contained root', () => {
  const makeSvg = () => {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg') as SVGSVGElement;
    const fo = document.createElementNS(svgNs, 'foreignObject');
    const root = document.createElement('div');
    root.innerHTML = '<input id="live-input" type="text">';
    fo.appendChild(root);
    svg.appendChild(fo);
    document.body.appendChild(svg);
    return { svg, root };
  };

  afterEach(() => { document.querySelectorAll('svg').forEach((s) => s.remove()); });

  it('carries explicit width/height attributes on the serialized root (an <img> needs intrinsic size)', async () => {
    const { svg } = makeSvg();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ width: 816, height: 1056 }), configurable: true,
    });
    const out = await serializeStorySvg(svg);
    expect(out).toMatch(/<svg[^>]*\swidth="816"/);
    expect(out).toMatch(/<svg[^>]*\sheight="1056"/);
  });

  it('stamps live form values into the serialized copy (fixup pass)', async () => {
    const { svg, root } = makeSvg();
    (root.querySelector('#live-input') as HTMLInputElement).value = 'hello';
    const out = await serializeStorySvg(svg);
    expect(out).toContain('value="hello"');
  });
});

describe('svgToImage — rasterize readiness', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses a percent-encoded data: URL (never a Blob URL — taints Chromium/WebKit)', async () => {
    let seenSrc = '';
    class FakeImage {
      decode = vi.fn(async () => {});
      set src(v: string) { seenSrc = v; }
    }
    vi.stubGlobal('Image', FakeImage);
    await svgToImage('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(seenSrc.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(seenSrc).not.toContain('blob:');
  });

  it('awaits document.fonts.ready and image decode before resolving', async () => {
    let fontsAwaited = false;
    const fontsReady = Promise.resolve().then(() => { fontsAwaited = true; });
    Object.defineProperty(document, 'fonts', { value: { ready: fontsReady }, configurable: true });
    const decode = vi.fn(async () => {});
    class FakeImage {
      decode = decode;
      set src(_v: string) { /* data: URL, nothing to load */ }
    }
    vi.stubGlobal('Image', FakeImage);
    await svgToImage('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(fontsAwaited).toBe(true);
    expect(decode).toHaveBeenCalled();
  });
});
