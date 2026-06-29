// The agent-HTML iframe (stories) carries a defense-in-depth CSP. Its font-src MUST allow 'self'
// so the app's SELF-HOSTED fonts (JetBrains Mono / Inter at same-origin /_next/static/media/*.woff2)
// load inside the iframe — otherwise embedded ECharts charts fall back to a system font and the chart
// text renders with the wrong typeface/size. Regression guard for that.
import { AGENT_IFRAME_CSP } from '@/lib/html/agent-iframe-csp';

describe('AGENT_IFRAME_CSP', () => {
  const directives = Object.fromEntries(
    AGENT_IFRAME_CSP.split(';').map((d) => {
      const [name, ...vals] = d.trim().split(/\s+/);
      return [name, vals];
    }),
  );

  it('allows same-origin self-hosted fonts (the chart-font fix)', () => {
    expect(directives['font-src']).toContain("'self'");
  });

  it('still allows Google web-fonts and data URIs', () => {
    expect(directives['font-src']).toContain('https://fonts.gstatic.com');
    expect(directives['font-src']).toContain('data:');
  });

  it('keeps the lockdown baseline (default-src none, no script execution in the iframe)', () => {
    expect(directives['default-src']).toContain("'none'");
    expect(AGENT_IFRAME_CSP).not.toContain('script-src');
  });
});
