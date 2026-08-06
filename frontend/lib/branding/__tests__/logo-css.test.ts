/**
 * The in-app logo is painted by CSS on `[aria-label="Workspace logo"]`, and
 * that CSS is DERIVED from `OrgConfig.branding` — setting `logoLight`/`logoDark`
 * in the config is the one knob that changes the logo everywhere (app, emails,
 * share cards). The styles document remains a hand-written override layer on
 * top, not a second required step.
 */
import { logoCssFromBranding, DEFAULT_STYLES, DEFAULT_CONFIG } from '@/lib/branding/whitelabel';

describe('logoCssFromBranding', () => {
  it('paints the workspace logo from the branding URLs, light and dark', () => {
    const css = logoCssFromBranding({ logoLight: '/acme-light.svg', logoDark: '/acme-dark.svg' });
    expect(css).toContain(`[aria-label="Workspace logo"]`);
    expect(css).toContain(`url('/acme-light.svg')`);
    expect(css).toMatch(/\.dark \[aria-label="Workspace logo"\][^}]*url\('\/acme-dark\.svg'\)/);
  });

  it('falls back to the default logo URLs when branding omits them', () => {
    const css = logoCssFromBranding({});
    expect(css).toContain(`url('${DEFAULT_CONFIG.branding.logoLight}')`);
    expect(css).toContain(`url('${DEFAULT_CONFIG.branding.logoDark}')`);
  });

  it('DEFAULT_STYLES is exactly the derived CSS for the default branding', () => {
    // One source for the rule shape — and the seed-equality check in the styles
    // loader depends on this identity.
    expect(DEFAULT_STYLES).toBe(logoCssFromBranding(DEFAULT_CONFIG.branding));
  });

  it('quote/paren/brace injection in a URL cannot escape the css url()', () => {
    const css = logoCssFromBranding({ logoLight: `/x.svg') } body { display:none } q('`, logoDark: '/y.svg' });
    // Whatever survives sanitization stays INSIDE the url('…') token: no quote,
    // paren or brace from the input remains, so no selector or rule can be
    // smuggled in. Structure check: exactly the two intended rule blocks.
    for (const m of css.matchAll(/url\('([^']*)'\)/g)) {
      expect(m[1]).toMatch(/^[\w\-./:?=&%#~+@,]*$/);
    }
    expect(css.match(/\{/g)).toHaveLength(2);
    expect(css.match(/\}/g)).toHaveLength(2);
  });
});
