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
 * The specimen fragment (claude.ai/design-style theme card): kicker with the font pairing,
 * the theme name huge in its display face, the themed <hr> (structural css layer), a swatch
 * ramp read straight from the token contract, and a card + button + chart-token duo — the
 * theme card shows the SYSTEM (type, tokens, radius, rules), not a fake report.
 */
function specimen(t: (typeof STORY_THEMES)[number]): string {
  const fontLabel = t.fonts.body === t.fonts.display ? t.fonts.display : `${t.fonts.display} / ${t.fonts.body}`;
  const swatches = ['--background', '--muted', '--border', '--chart-4', '--chart-3', '--chart-2', '--chart-5', '--chart-1', '--primary']
    .map((v) => `<div class="h-6 flex-1 rounded-md border border-border" style="background:var(${v})"></div>`)
    .join('');
  const bars = [
    ['--chart-2', 40], ['--chart-3', 62], ['--chart-4', 50], ['--chart-1', 95], ['--chart-5', 72],
  ].map(([v, h]) => `<div class="flex-1 rounded-sm" style="height:${h}%;background:var(${v})"></div>`).join('');
  return `
<div class="bg-background text-foreground p-6" style="width:${WIDTH}px;min-height:${HEIGHT}px">
  <div class="flex items-baseline justify-between">
    <span class="text-xs font-semibold tracking-wide text-primary">${fontLabel}</span>
    <span class="text-xs text-muted-foreground">radius ${t.cssVars['--radius']}</span>
  </div>
  <h1 class="mt-1 text-6xl font-bold tracking-tight">${t.label}</h1>
  <hr class="my-5" />
  <div class="flex gap-1.5">${swatches}</div>
  <div class="mt-5 grid grid-cols-5 gap-4">
    <div class="col-span-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <p class="text-sm text-muted-foreground">The quick brown fox jumps over the lazy dog.</p>
      <div class="mt-4 flex items-center gap-2">
        <span class="inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Continue</span>
        <span class="inline-block rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground">Q3</span>
      </div>
    </div>
    <div class="col-span-2 flex items-end gap-1.5 rounded-lg border border-border bg-card p-3">${bars}</div>
  </div>
</div>`;
}

/** Nocturne is dark-first (§5) — its preview shows the dark variant; the rest render light. */
const DARK_PREVIEW = new Set(['nocturne']);

function pageHtml(themeName: string, sample: string, compiledCss: string, dark: boolean): string {
  return `<!DOCTYPE html>
<html class="${dark ? 'dark' : 'light'}">
<head><meta charset="utf-8">
<style>${getStoryFontCss(themeName)}</style>
<style>${compiledCss}</style>
<style>html,body{margin:0;padding:0}</style>
</head>
<body><div data-theme="${themeName}">${sample}</div></body>
</html>`;
}

async function main(): Promise<void> {
  // The REAL compile path (force = the format:'jsx' pipeline): shadcn token layer + recipe
  // classes + the [data-theme] token blocks — exactly what a saved story's compiledCss holds.
  const compiledCss = await compileStoryCss(STORY_THEMES.map(specimen).join('\n'), { force: true });
  if (!compiledCss) throw new Error('compileStoryCss returned no CSS for the specimen fragments');

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
        route.fulfill({ body: pageHtml(theme.name, specimen(theme), compiledCss, dark), contentType: 'text/html' }),
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
