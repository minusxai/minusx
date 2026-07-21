/**
 * Theme preview-image generation (Story_Design_V2 §5 / §11 Phase 3).
 *
 * Renders ONE canonical sample story fragment per design theme through the REAL jsx compile
 * path (`compileStoryCss({ force: true })` — the same Tailwind + token-block pipeline every
 * saved story goes through, so previews are truthful and regenerate on theme changes), then
 * screenshots each at 640×400 into `public/story-themes/<name>.png` with Playwright chromium.
 *
 * Run: `npm run generate-theme-previews` (tsx --conditions react-server, like the other
 * server-module scripts). The PNGs are consumed by the settings picker (StoryThemePicker)
 * and the Clarify `type:'design'` option cards (lib/branding/story-theme-options.ts).
 */
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import { compileStoryCss } from '../lib/data/story/story-css.server';
import { STORY_THEMES } from '../lib/data/story/story-themes';
import { getStoryFontCss } from '../lib/data/story/story-fonts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'story-themes');
const WIDTH = 640;
const HEIGHT = 400;

/**
 * The canonical sample fragment: heading + prose, a Card-recipe stat pair, a Badge, table
 * rows, and a fake bar chart of divs colored by the chart tokens — representative shadcn
 * markup exercising exactly the tokens a theme swaps. Plain HTML with the shadcn utility
 * classes (the recipe classes are unioned into every jsx compile anyway).
 */
const SAMPLE = `
<div class="bg-background text-foreground p-5 space-y-4" style="width:${WIDTH}px;min-height:${HEIGHT}px">
  <div class="space-y-1">
    <span class="inline-block rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">Q3 REVIEW</span>
    <h1 class="text-2xl font-bold tracking-tight">Revenue held while churn fell</h1>
    <p class="text-sm text-muted-foreground">Monthly recurring revenue grew 8% as churn dropped to a two-year low.</p>
  </div>
  <div class="grid grid-cols-2 gap-3">
    <div class="rounded-lg border border-border bg-card p-3 text-card-foreground">
      <p class="text-xs text-muted-foreground">MRR</p>
      <p class="text-xl font-bold text-primary">$412k</p>
    </div>
    <div class="rounded-lg border border-border bg-card p-3 text-card-foreground">
      <p class="text-xs text-muted-foreground">Churn</p>
      <p class="text-xl font-bold">1.9%</p>
    </div>
  </div>
  <div class="flex items-end gap-2 h-24">
    <div class="flex-1 rounded-sm" style="height:45%;background:var(--chart-1)"></div>
    <div class="flex-1 rounded-sm" style="height:70%;background:var(--chart-2)"></div>
    <div class="flex-1 rounded-sm" style="height:55%;background:var(--chart-3)"></div>
    <div class="flex-1 rounded-sm" style="height:90%;background:var(--chart-4)"></div>
    <div class="flex-1 rounded-sm" style="height:65%;background:var(--chart-5)"></div>
  </div>
  <table class="w-full text-sm">
    <thead><tr class="border-b border-border text-left text-muted-foreground">
      <th class="py-1 font-medium">Region</th><th class="py-1 font-medium">MRR</th><th class="py-1 font-medium">Change</th>
    </tr></thead>
    <tbody>
      <tr class="border-b border-border"><td class="py-1">EMEA</td><td class="py-1">$168k</td><td class="py-1 text-primary font-semibold">+12%</td></tr>
      <tr><td class="py-1">Americas</td><td class="py-1">$244k</td><td class="py-1">+5%</td></tr>
    </tbody>
  </table>
</div>`;

/** Nocturne is dark-first (§5) — its preview shows the dark variant; the rest render light. */
const DARK_PREVIEW = new Set(['nocturne']);

function pageHtml(themeName: string, compiledCss: string, dark: boolean): string {
  return `<!DOCTYPE html>
<html class="${dark ? 'dark' : 'light'}">
<head><meta charset="utf-8">
<style>${getStoryFontCss(themeName)}</style>
<style>${compiledCss}</style>
<style>html,body{margin:0;padding:0}</style>
</head>
<body><div data-theme="${themeName}">${SAMPLE}</div></body>
</html>`;
}

async function main(): Promise<void> {
  // The REAL compile path (force = the format:'jsx' pipeline): shadcn token layer + recipe
  // classes + the [data-theme] token blocks — exactly what a saved story's compiledCss holds.
  const compiledCss = await compileStoryCss(SAMPLE, { force: true });
  if (!compiledCss) throw new Error('compileStoryCss returned no CSS for the sample fragment');

  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    // Serve /fonts/* from public so the theme font assets actually render in the preview.
    await page.route('**/fonts/**', async (route) => {
      const url = new URL(route.request().url());
      const body = await fs.readFile(path.join(ROOT, 'public', url.pathname));
      await route.fulfill({ body, contentType: 'font/ttf' });
    });
    for (const theme of STORY_THEMES) {
      const dark = DARK_PREVIEW.has(theme.name);
      await page.route('**/preview.html', (route) =>
        route.fulfill({ body: pageHtml(theme.name, compiledCss, dark), contentType: 'text/html' }),
      );
      await page.goto('http://story-theme-preview.local/preview.html');
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(OUT_DIR, `${theme.name}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      await page.unroute('**/preview.html');
      console.log(`wrote ${path.relative(ROOT, file)}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
