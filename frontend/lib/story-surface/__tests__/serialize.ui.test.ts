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

  it('rewrites root-relative font urls (platform story fonts are same-origin static assets)', async () => {
    fakeFontFetch();
    const out = await inlineFontUrls('@font-face{font-family:"Inter";src:url("/fonts/i.woff2")}');
    expect(out).toContain('data:font/woff2;base64,');
    expect(out).not.toContain('/fonts/i.woff2');
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

  it('splices data-URI fonts into IN-ROOT style nodes in the parsed copy only (live DOM untouched)', async () => {
    // Styles (incl. the platform font css) live inside the story root now — the serializer must
    // rewrite their remote url() refs to data: URIs in the CLONE, and never touch the live node.
    fakeFontFetch();
    const { svg, root } = makeSvg();
    const fonts = document.createElement('style');
    fonts.setAttribute('data-mx-fonts', '');
    fonts.textContent = '@font-face{font-family:X;src:url(https://cdn/x.woff2)}';
    root.insertBefore(fonts, root.firstChild);
    const out = await serializeStorySvg(svg);
    expect(out).toContain('data:font/woff2;base64,');
    expect(out).not.toContain('https://cdn/x.woff2');
    // The live DOM keeps the cacheable URL form.
    expect(fonts.textContent).toContain('https://cdn/x.woff2');
  });

  it('inlines <img> srcs as data: URIs in the parsed copy (SVG-as-image blocks external refs)', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
    }) as unknown as Response) as unknown as typeof fetch;
    const { svg, root } = makeSvg();
    const img = document.createElement('img');
    img.setAttribute('src', '/hero.png');
    root.appendChild(img);
    const out = await serializeStorySvg(svg);
    expect(out).toContain('data:image/png;base64,');
    expect(out).not.toContain('src="/hero.png"');
    // The live DOM keeps the URL form.
    expect(img.getAttribute('src')).toBe('/hero.png');
  });

  // CAPTURE PARITY (Story_Design_V2 §4 "no fidelity fork"): the serialized SVG's intrinsic size is
  // its width/height ATTRIBUTES, while every capture site derives its output box from the LIVE svg's
  // element box. A surface pinned wider than the container the user sees would serialize that wider
  // layout — the agent's screenshot would show content the reader cannot. So whatever width the
  // surface was told to apply must be exactly what the serialized root carries.
  it('carries the APPLIED (user-visible) width — not a logical canvas width', async () => {
    const { svg } = makeSvg();
    const fo = svg.querySelector('foreignObject')!;
    svg.setAttribute('width', '1280'); // mounted at the logical canvas width…
    fo.setAttribute('width', '1280');
    svg.setAttribute('height', '0');
    // …then the fluid caller pushes the measured container width in (mountStorySurface().applyWidth).
    svg.setAttribute('width', '1104');
    fo.setAttribute('width', '1104');
    svg.setAttribute('height', '600');
    const out = await serializeStorySvg(svg);
    expect(out).toMatch(/<svg[^>]*\swidth="1104"/);
    expect(out).toMatch(/<foreignObject[^>]*\swidth="1104"/);
    // The explicit-size stamp must NOT fire here (attrs are present) — jsdom's zero-sized
    // getBoundingClientRect would otherwise overwrite the applied width with 0.
    expect(out).not.toMatch(/<svg[^>]*\swidth="0"/);
  });

  it('stamps live form values into the serialized copy (fixup pass)', async () => {
    const { svg, root } = makeSvg();
    (root.querySelector('#live-input') as HTMLInputElement).value = 'hello';
    const out = await serializeStorySvg(svg);
    expect(out).toContain('value="hello"');
  });

  // COLOR-MODE STAMP (post-6a): the standalone SVG document has no <html>, so the clone's story
  // root carries the current color-mode class — story/kit `.dark`-scoped rules keep resolving.
  // The Chakra token-host stamp (`chakra-theme`) is DELETED: no Chakra reaches the iframe after
  // the Phase-6a mirror shrink, so there is no Chakra var chain left to resolve.
  describe('color-mode stamp', () => {
    afterEach(() => { document.documentElement.classList.remove('dark'); });

    it('stamps the CLONED story root with light (no chakra-theme; live DOM untouched)', async () => {
      const { svg, root } = makeSvg();
      const out = await serializeStorySvg(svg);
      expect(out).toMatch(/<div[^>]*class="light"/);
      expect(out).not.toContain('chakra-theme');
      expect(root.getAttribute('class')).toBeNull();
    });

    it('stamps dark instead when the owner document is in dark mode', async () => {
      document.documentElement.classList.add('dark');
      const { svg } = makeSvg();
      const out = await serializeStorySvg(svg);
      expect(out).toMatch(/<div[^>]*class="dark"/);
      expect(out).not.toMatch(/class="[^"]*light/);
    });

    it('preserves the story root\'s existing classes', async () => {
      const { svg, root } = makeSvg();
      root.setAttribute('class', 'authored');
      const out = await serializeStorySvg(svg);
      expect(out).toMatch(/<div[^>]*class="authored light"/);
      expect(root.getAttribute('class')).toBe('authored');
    });
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
