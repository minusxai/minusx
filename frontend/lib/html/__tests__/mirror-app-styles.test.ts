// When app stylesheet rules are mirrored into the story iframe's inline <style>, their RELATIVE
// url() refs (e.g. @font-face `url("../media/x.woff2")` authored relative to /_next/static/css/…)
// must be rewritten to ABSOLUTE — otherwise they resolve against the iframe's base (/f/<id>) and
// 404, so self-hosted fonts (JetBrains Mono / Inter) never load and chart text renders wrong.
import { absolutizeCssUrls, collectFontFaceCss } from '@/lib/html/mirror-app-styles';

const CSS_BASE = 'http://localhost:3000/_next/static/css/abc.css';

// Phase 6a (Renderer_v2): the mirror is SHRUNK to @font-face only — embed chrome is compiled
// into every story's CSS (kit + EMBED_CHROME_FILES recipe union), and Chakra never reaches the
// iframe. Mirroring the app's full CSSOM (~455KB, 43% emotion runtime rules) is deleted.
describe('collectFontFaceCss (the 6a mirror shrink)', () => {
  const rules = [
    { cssText: '@font-face{font-family:"JetBrains Mono";src:url("../media/x.woff2") format("woff2")}', base: CSS_BASE },
    { cssText: '.chakra-card{padding:16px}', base: CSS_BASE },
    { cssText: '.css-1abc{color:red}', base: CSS_BASE },
    { cssText: '@font-face{font-family:Inter;src:url(/fonts/inter.woff2)}', base: CSS_BASE },
    { cssText: '@media (min-width:600px){.x{color:blue}}', base: CSS_BASE },
  ];

  it('keeps ONLY @font-face rules, with relative urls absolutized', () => {
    const out = collectFontFaceCss(rules);
    expect(out).toContain('font-family:"JetBrains Mono"');
    expect(out).toContain('http://localhost:3000/_next/static/media/x.woff2');
    expect(out).toContain('font-family:Inter');
    expect(out).not.toContain('.chakra-card');
    expect(out).not.toContain('.css-1abc');
    expect(out).not.toContain('@media');
  });

  it('returns empty for no font rules', () => {
    expect(collectFontFaceCss([{ cssText: '.a{color:red}', base: CSS_BASE }])).toBe('');
  });
});

describe('absolutizeCssUrls', () => {
  it('rewrites a relative ../media font url to absolute against the stylesheet href', () => {
    const out = absolutizeCssUrls('@font-face{font-family:"JetBrains Mono";src:url("../media/x.woff2") format("woff2")}', CSS_BASE);
    expect(out).toContain('http://localhost:3000/_next/static/media/x.woff2');
    expect(out).not.toContain('../media/');
  });

  it('handles single/double/unquoted url() forms', () => {
    expect(absolutizeCssUrls("src:url('../media/a.woff2')", CSS_BASE)).toContain('/_next/static/media/a.woff2');
    expect(absolutizeCssUrls('src:url(../media/b.woff2)', CSS_BASE)).toContain('/_next/static/media/b.woff2');
  });

  it('leaves already-absolute / data / blob / root-relative / fragment refs untouched', () => {
    const cases = [
      'src:url("https://fonts.gstatic.com/s/x.woff2")',
      'src:url(data:font/woff2;base64,AAAA)',
      'background:url(blob:http://localhost:3000/abc)',
      'background:url("/static/img.png")',     // root-relative already resolves correctly
      'mask:url(#clip)',                        // in-document fragment
    ];
    for (const c of cases) expect(absolutizeCssUrls(c, CSS_BASE)).toBe(c);
  });

  it('is a no-op for rules with no url()', () => {
    const rule = '.x{color:red;font-size:12px}';
    expect(absolutizeCssUrls(rule, CSS_BASE)).toBe(rule);
  });
});
