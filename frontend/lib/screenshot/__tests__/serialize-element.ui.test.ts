/**
 * Generic app-page serialization capture (Story_Design_V2 §4) — replaces snapdom for
 * dashboards/questions/notebooks: the target element is cloned into an in-memory
 * `<svg><foreignObject>` document with ALL same-origin document CSS inlined, the parsed-copy
 * fixup pass applied (scroll transforms, form-value stamping, canvas→<img> stamps, transient
 * portal drop), and images inlined as data: URIs — so the result renders in an isolated
 * <img> context (no parent document, no network) without tainting the rasterizing canvas.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  collectDocumentCss,
  serializeElementToSvg,
  inlineCssUrls,
  TRANSIENT_PORTAL_SELECTOR,
} from '@/lib/screenshot/serialize-element';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('collectDocumentCss', () => {
  it('collects <style> element contents (Chakra/Emotion styles are same-origin style elements)', () => {
    const s1 = document.createElement('style');
    s1.textContent = '.chakra-card{padding:16px}';
    const s2 = document.createElement('style');
    s2.textContent = ':root{--mx-accent:#123}';
    document.head.appendChild(s1);
    document.body.appendChild(s2);
    const css = collectDocumentCss(document);
    // jsdom routes style-element sheets through CSSOM (no ownerNode), which reformats whitespace.
    expect(css).toMatch(/\.chakra-card\s*\{\s*padding:\s*16px;?\s*\}/);
    expect(css).toMatch(/--mx-accent:\s*#123/);
  });

  it('collects link-sheet cssRules and skips cross-origin sheets without throwing', () => {
    const linkNode = document.createElement('link');
    const fakeDoc = {
      styleSheets: [
        { ownerNode: linkNode, cssRules: [{ cssText: '.from-link{color:red}' }] },
        { ownerNode: document.createElement('link'), get cssRules(): CSSRuleList { throw new DOMException('cross-origin', 'SecurityError'); } },
      ],
    } as unknown as Document;
    const css = collectDocumentCss(fakeDoc);
    expect(css).toContain('.from-link{color:red}');
  });
});

describe('inlineCssUrls', () => {
  it('inlines absolute AND relative url() refs against the base, leaving data: alone', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'font/woff2' },
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    })) as unknown as typeof fetch;
    const css = '@font-face{src:url(/fonts/x.woff2)} .a{background:url("data:image/png;base64,AA")}';
    const out = await inlineCssUrls(css, 'https://app.example/');
    expect(out).toContain('data:font/woff2;base64,');
    expect(out).not.toContain('/fonts/x.woff2');
    expect(out).toContain('data:image/png;base64,AA');
    expect(global.fetch).toHaveBeenCalledWith('https://app.example/fonts/x.woff2');
  });

  it('keeps the original url when the fetch fails (best-effort, capture must not break)', async () => {
    global.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const css = '.a{background:url(https://cdn.example/y.png)}';
    expect(await inlineCssUrls(css, 'https://app.example/')).toBe(css);
  });
});

describe('serializeElementToSvg', () => {
  const stubRect = (el: HTMLElement, width: number, height: number) => {
    Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
  };

  it('wraps the clone in <svg><foreignObject> with explicit width/height and document CSS inlined', async () => {
    const style = document.createElement('style');
    style.textContent = '.dash{color:green}';
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.innerHTML = '<div class="dash">Revenue</div>';
    stubRect(el, 900, 500);
    document.body.appendChild(el);
    const out = await serializeElementToSvg(el);
    expect(out).toMatch(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(out).toMatch(/<svg[^>]*\swidth="900"/);
    expect(out).toMatch(/<svg[^>]*\sheight="500"/);
    expect(out).toContain('<foreignObject');
    expect(out).toMatch(/\.dash\s*\{\s*color:\s*green;?\s*\}/);
    expect(out).toContain('Revenue');
    expect(out.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)!.length).toBe(1); // no duplicate declaration
  });

  // Chakra declares token vars under `:where(html, .chakra-theme)` — `html` is an ELEMENT selector,
  // so copying documentElement.className onto the wrapper <div> can never match it. Without an
  // explicit chakra-theme + color-mode host, every var-backed Chakra style in a dashboard/question
  // capture resolves to nothing and rasterizes transparent.
  it('wraps the clone in a chakra-theme host carrying the color mode', async () => {
    const el = document.createElement('div');
    stubRect(el, 100, 50);
    document.body.appendChild(el);
    document.documentElement.classList.remove('dark');
    const out = await serializeElementToSvg(el);
    expect(out).toMatch(/<div[^>]*class="chakra-theme light/);
    document.documentElement.classList.add('dark');
    const outDark = await serializeElementToSvg(el);
    expect(outDark).toMatch(/<div[^>]*class="chakra-theme dark/);
    document.documentElement.classList.remove('dark');
  });

  it('applies the fixup pass: scroll transforms and form-value stamping, live DOM untouched', async () => {
    const el = document.createElement('div');
    el.innerHTML = '<div id="scroller"><table id="t"></table></div><input id="i" type="text">';
    stubRect(el, 600, 300);
    document.body.appendChild(el);
    Object.defineProperty(el.querySelector('#scroller') as HTMLElement, 'scrollLeft', { value: 120, configurable: true });
    (el.querySelector('#i') as HTMLInputElement).value = 'typed';
    const out = await serializeElementToSvg(el);
    expect(out).toContain('translate(-120px, 0px)');
    expect(out).toContain('value="typed"');
    // the LIVE tree is untouched
    expect((el.querySelector('#t') as HTMLElement).style.transform).toBe('');
    expect((el.querySelector('#i') as HTMLElement).getAttribute('value')).toBeNull();
  });

  it('stamps canvas content as a data: <img> when toDataURL succeeds', async () => {
    const el = document.createElement('div');
    el.innerHTML = '<canvas id="c" width="10" height="10"></canvas>';
    stubRect(el, 100, 100);
    document.body.appendChild(el);
    (el.querySelector('#c') as HTMLCanvasElement).toDataURL = () => 'data:image/png;base64,CANVAS';
    const out = await serializeElementToSvg(el);
    expect(out).toContain('data:image/png;base64,CANVAS');
    expect(out).not.toContain('<canvas');
  });

  it('a tainted canvas (toDataURL throws) is skipped without failing the capture', async () => {
    const el = document.createElement('div');
    el.innerHTML = '<canvas id="c"></canvas><p>still here</p>';
    stubRect(el, 100, 100);
    document.body.appendChild(el);
    (el.querySelector('#c') as HTMLCanvasElement).toDataURL = () => { throw new DOMException('tainted', 'SecurityError'); };
    const out = await serializeElementToSvg(el);
    expect(out).toContain('still here');
  });

  it('drops transient portal popovers from the clone', async () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>content</p><div data-scope="popover" data-part="positioner"><div>tooltip body</div></div>';
    stubRect(el, 100, 100);
    document.body.appendChild(el);
    expect(el.querySelector(TRANSIENT_PORTAL_SELECTOR)).toBeTruthy();
    const out = await serializeElementToSvg(el);
    expect(out).toContain('content');
    expect(out).not.toContain('tooltip body');
    expect(el.querySelector(TRANSIENT_PORTAL_SELECTOR)).toBeTruthy(); // live DOM untouched
  });

  it('inlines same-origin/cors images as data: URIs, leaving failures as-is (graceful skip)', async () => {
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
    const el = document.createElement('div');
    el.innerHTML = '<img id="a" src="https://cdn.example/ok.png"><img id="b" src="https://cdn.example/blocked.png">';
    stubRect(el, 100, 100);
    document.body.appendChild(el);
    const out = await serializeElementToSvg(el);
    expect(out).toContain('data:image/png;base64,');
    expect(out).toContain('https://cdn.example/blocked.png'); // left as-is: SVG-as-image simply won't fetch it
  });
});
