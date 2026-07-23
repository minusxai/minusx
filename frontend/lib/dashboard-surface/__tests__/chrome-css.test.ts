/**
 * Dashboard chrome CSS artifact (Renderer_v2 Phase 8a — self-contained dashboards).
 *
 * Dashboards have NO authored classes — every class inside the dashboard iframe surface comes
 * from our own components (kit + embed chrome + dashboard view chrome), a closed set. So ONE
 * static compiled stylesheet covers every dashboard, generated at build time by
 * scripts/generate-dashboard-chrome-css.ts into lib/dashboard-surface/chrome-css.gen.ts.
 *
 * Freshness guard (same contract as recipe-classes.test.ts): if a chrome source changes and the
 * artifact is stale, the iframe silently misses styles — this test fails instead. Regenerate:
 *   npm run generate-dashboard-chrome-css
 */
import { describe, it, expect } from 'vitest';
import {
  collectDashboardChromeCandidates,
  readGridLibraryCss,
  dashboardChromeVersion,
} from '../../../scripts/generate-dashboard-chrome-css';
import { DASHBOARD_CHROME_CSS, DASHBOARD_CHROME_CSS_VERSION } from '../chrome-css.gen';

describe('dashboard chrome css artifact', () => {
  it('is fresh: version matches a recomputation from the current sources', () => {
    const candidates = collectDashboardChromeCandidates();
    const libCss = readGridLibraryCss();
    expect(DASHBOARD_CHROME_CSS_VERSION).toBe(dashboardChromeVersion(candidates, libCss));
  });

  it('carries the react-grid-layout library css (grid positioning inside the iframe)', () => {
    expect(DASHBOARD_CHROME_CSS).toContain('.react-grid-item');
    expect(DASHBOARD_CHROME_CSS).toContain('.react-resizable-handle');
  });

  it('carries the react-day-picker library css (DatePicker calendar portals into the iframe body)', () => {
    expect(DASHBOARD_CHROME_CSS).toContain('.rdp');
  });

  it('carries the shadcn token layer for both modes (iframe has no app stylesheet)', () => {
    expect(DASHBOARD_CHROME_CSS).toContain(':root');
    expect(DASHBOARD_CHROME_CSS).toContain('.dark');
    // Chart tokens must resolve for VegaChart (app palette substituted, Phase 3 contract).
    expect(DASHBOARD_CHROME_CSS).toContain('--chart-1');
  });

  it('compiles the chrome utilities the dashboard tree actually uses', () => {
    // Tile chrome (DashboardView) and kit card surfaces.
    expect(DASHBOARD_CHROME_CSS).toContain('.bg-card');
    // Sticky table headers (TableV2/PivotTable): the story compile BANS sticky for authored
    // CSS, but chrome is our own code — the chrome compile must NOT run the banned partition.
    expect(DASHBOARD_CHROME_CSS).toMatch(/\.sticky\s*\{/);
    // The marker gutter (pl-10) reserved on the dashboard region.
    expect(DASHBOARD_CHROME_CSS).toContain('.pl-10');
  });

  it('carries the design-theme token blocks (data-theme dashboards, Phase 3 parity)', () => {
    expect(DASHBOARD_CHROME_CSS).toContain('[data-theme');
  });

  it('is self-contained: no external fetches (url() refs) in the compiled sheet', () => {
    // data: URIs are fine; anything http(s)/relative would 404 or taint a serialized capture.
    const externals = Array.from(DASHBOARD_CHROME_CSS.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g))
      .map((m) => m[1])
      .filter((u) => !u.startsWith('data:'));
    expect(externals).toEqual([]);
  });
});
