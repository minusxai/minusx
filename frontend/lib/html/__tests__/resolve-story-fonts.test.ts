// Resolve a story's @import web-fonts into concrete @font-face CSS so the capture (snapdom, which
// reads the GLOBAL document and ignores @import — issues #441/#309) can embed the real fonts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectStoryFontImports, resolveImportFontCss, clearStoryFontCache } from '../resolve-story-fonts';

function fakeDoc(styleTexts: string[]): Document {
  return { querySelectorAll: () => styleTexts.map(t => ({ textContent: t })) } as unknown as Document;
}

beforeEach(() => {
  clearStoryFontCache();
  vi.restoreAllMocks();
});

describe('collectStoryFontImports', () => {
  it('extracts @import url() targets from <style> blocks', () => {
    const doc = fakeDoc([`@import url('https://fonts.example/css?family=Cormorant');\n.x{color:red}`]);
    expect(collectStoryFontImports(doc)).toEqual(['https://fonts.example/css?family=Cormorant']);
  });

  it('returns [] when there are no imports', () => {
    expect(collectStoryFontImports(fakeDoc(['.x{color:red}']))).toEqual([]);
  });

  it('keeps the WHOLE url even with in-URL semicolons (Google Fonts wght lists)', () => {
    const url = 'https://fonts.example/css?family=Playfair:wght@0,700;0,900&display=swap';
    expect(collectStoryFontImports(fakeDoc([`@import url('${url}');`]))).toEqual([url]);
  });

  it('collects from multiple style blocks', () => {
    expect(collectStoryFontImports(fakeDoc([`@import url(a);`, `@import url("b");`]))).toEqual(['a', 'b']);
  });
});

describe('resolveImportFontCss', () => {
  it('fetches each import and concatenates the @font-face CSS', async () => {
    global.fetch = vi.fn(async () => ({ text: async () => '@font-face{font-family:Cormorant;src:url(x)}' })) as unknown as typeof fetch;
    expect(await resolveImportFontCss(['u1'])).toContain('@font-face');
  });

  it('caches by the URL set — fetches once across repeat calls', async () => {
    const f = vi.fn(async () => ({ text: async () => '@font-face{}' }));
    global.fetch = f as unknown as typeof fetch;
    await resolveImportFontCss(['u1']);
    await resolveImportFontCss(['u1']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns "" and recovers (re-fetches next time) on failure', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await resolveImportFontCss(['u1'])).toBe('');
    global.fetch = vi.fn(async () => ({ text: async () => '@font-face{}' })) as unknown as typeof fetch;
    expect(await resolveImportFontCss(['u1'])).toContain('@font-face'); // not stuck on the failed cache
  });

  it('returns "" when there are no imports (no fetch)', async () => {
    const f = vi.fn();
    global.fetch = f as unknown as typeof fetch;
    expect(await resolveImportFontCss([])).toBe('');
    expect(f).not.toHaveBeenCalled();
  });
});
