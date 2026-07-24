/**
 * Story design themes — ONE registry, four consumers (Story_Design_V2 §5):
 *  (a) the CSS emitter (`storyThemeCss` → appended to every jsx story's compiledCss by
 *      lib/data/story/story-css.server.ts, as tiny `[data-theme="<name>"]` variable blocks —
 *      instant in-app theme switching, no recompile),
 *  (b) the settings picker UI (components/views/story/StoryThemePicker) and the Clarify
 *      `type:'design'` preset (lib/branding/story-theme-options.ts projects this registry),
 *  (c) preview-image generation (scripts/generate-theme-previews.ts),
 *  (d) font-asset generation (lib/data/story/story-fonts.ts maps each theme's families to
 *      the bundled font assets).
 *
 * A theme is CSS custom-property VALUES only (the shadcn/tweakcn convention): components and
 * utility classes are identical across themes; a theme swaps the token set TW_INPUT_JSX maps
 * (--background/--foreground/--card/… /--chart-1..5/--radius) plus fonts. Themes set DEFAULTS
 * only — authored/agent CSS is injected after the compiled sheet in document order and wins.
 *
 * FONTS — §5 families vs bundled assets: only Inter, Noto Serif and JetBrains Mono ship as
 * static assets (public/fonts); the §5 design families are substituted to the closest bundled
 * family (documented per theme below) rather than fetching new binaries. Swapping a family
 * here + adding its asset in story-fonts.ts upgrades a theme in one edit.
 */
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { STORY_THEME_NAMES } from '@/lib/validation/atlas-schemas';

export type { StoryThemeName };
export { STORY_THEME_NAMES };

export interface StoryThemeFonts {
  /** Display (heading) font family — a family registered in lib/data/story/story-fonts.ts. */
  display: string;
  /** Body font family. */
  body: string;
  /** Optional mono family for code/pre. */
  mono?: string;
}

export interface StoryTheme {
  /** The schema enum value — what `<theme>…</theme>` carries. */
  name: StoryThemeName;
  /** Short human label for the picker. */
  label: string;
  /** One-line personality summary (picker + Clarify design preset). */
  description: string;
  fonts: StoryThemeFonts;
  /**
   * The full shadcn token contract — exactly the vars TW_INPUT_JSX maps, plus --radius.
   * ONE canonical palette: themes are SELF-CONTAINED designs. A themed story renders the same
   * in a light or dark app; the surface mode follows {@link storyThemeMode}, not the app.
   */
  cssVars: Record<string, string>;
  /**
   * Structural layer BEYOND tokens — restrained element-level CSS giving the theme a physical
   * personality (rule weight, ::selection tint, blockquote/table treatments), the way a real
   * design system styles primitives, not just colors. Authored with `&` as the theme-scope
   * placeholder; the emitter substitutes `[data-theme="<name>"]`. Keep it to a handful of
   * element rules — utilities/components stay identical across themes.
   */
  css?: string;
}

/** CSS fallback stack per bundled family (the emitter appends it after the quoted family). */
const FAMILY_FALLBACKS: Record<string, string> = {
  'Inter': 'ui-sans-serif, system-ui, sans-serif',
  'Noto Serif': 'Georgia, serif',
  'JetBrains Mono': 'ui-monospace, SFMono-Regular, monospace',
};

export const STORY_THEMES: StoryTheme[] = [
  {
    // Stark Swiss editorial: pure white field, near-black ink, ONE red accent, zero radius.
    // §5 fonts Archivo/Inter → Inter/Inter (Archivo not bundled; Inter is the closest bundled grotesque).
    name: 'modernist',
    label: 'Modernist',
    description: 'Stark Swiss editorial — white, near-black, one red accent; Archivo display over Inter, zero radius.',
    fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    css: [
      '& hr { border: none; height: 2px; background: var(--foreground); }',
      '& ::selection { background: var(--primary); color: var(--primary-foreground); }',
      '& blockquote { border-left: none; border-top: 2px solid var(--foreground); padding: 0.75rem 0 0; font-style: normal; font-weight: 600; }',
    ].join('\n'),
    cssVars: {
      '--radius': '0rem',
      '--background': 'oklch(1 0 0)',
      '--foreground': 'oklch(0.15 0 0)',
      '--card': 'oklch(0.99 0 0)',
      '--card-foreground': 'oklch(0.15 0 0)',
      '--popover': 'oklch(1 0 0)',
      '--popover-foreground': 'oklch(0.15 0 0)',
      '--primary': 'oklch(0.55 0.22 27)',
      '--primary-foreground': 'oklch(0.99 0 0)',
      '--secondary': 'oklch(0.955 0 0)',
      '--secondary-foreground': 'oklch(0.2 0 0)',
      '--muted': 'oklch(0.96 0 0)',
      '--muted-foreground': 'oklch(0.45 0 0)',
      '--accent': 'oklch(0.94 0 0)',
      '--accent-foreground': 'oklch(0.15 0 0)',
      '--destructive': 'oklch(0.55 0.22 27)',
      '--destructive-foreground': 'oklch(0.99 0 0)',
      '--border': 'oklch(0.88 0 0)',
      '--input': 'oklch(0.88 0 0)',
      '--ring': 'oklch(0.55 0.22 27)',
      '--chart-1': 'oklch(0.55 0.22 27)',
      '--chart-2': 'oklch(0.25 0 0)',
      '--chart-3': 'oklch(0.6 0 0)',
      '--chart-4': 'oklch(0.8 0 0)',
      '--chart-5': 'oklch(0.42 0.15 27)',
    },
  },
  {
    // Old-print, bookish: cream paper, sepia ink, ochre accents, gentle radius.
    // §5 fonts Cormorant Garamond/Lora → Noto Serif/Noto Serif (the one bundled serif).
    name: 'classical',
    label: 'Classical',
    description: 'Old-print, bookish — cream paper, sepia ink, oxblood accent; Cormorant Garamond display over Lora.',
    fonts: { display: 'Noto Serif', body: 'Noto Serif' },
    css: [
      '& hr { border: none; height: 1px; background: var(--border); }',
      '& ::selection { background: color-mix(in oklab, var(--primary) 25%, transparent); }',
      '& blockquote { font-style: italic; border-left: 1px solid var(--border); padding-left: 1.25rem; }',
    ].join('\n'),
    cssVars: {
      '--radius': '0.375rem',
      '--background': 'oklch(0.965 0.02 90)',
      '--foreground': 'oklch(0.28 0.03 55)',
      '--card': 'oklch(0.98 0.015 90)',
      '--card-foreground': 'oklch(0.28 0.03 55)',
      '--popover': 'oklch(0.98 0.015 90)',
      '--popover-foreground': 'oklch(0.28 0.03 55)',
      '--primary': 'oklch(0.45 0.14 25)',
      '--primary-foreground': 'oklch(0.97 0.02 90)',
      '--secondary': 'oklch(0.92 0.03 85)',
      '--secondary-foreground': 'oklch(0.32 0.04 60)',
      '--muted': 'oklch(0.93 0.025 88)',
      '--muted-foreground': 'oklch(0.48 0.04 60)',
      '--accent': 'oklch(0.9 0.045 80)',
      '--accent-foreground': 'oklch(0.3 0.04 55)',
      '--destructive': 'oklch(0.5 0.19 30)',
      '--destructive-foreground': 'oklch(0.97 0.02 90)',
      '--border': 'oklch(0.86 0.03 85)',
      '--input': 'oklch(0.86 0.03 85)',
      '--ring': 'oklch(0.45 0.14 25)',
      '--chart-1': 'oklch(0.5 0.13 25)',
      '--chart-2': 'oklch(0.47 0.1 245)',
      '--chart-3': 'oklch(0.64 0.12 75)',
      '--chart-4': 'oklch(0.46 0.12 130)',
      '--chart-5': 'oklch(0.63 0.12 92)',
    },
  },
  {
    // Dark-first, technical: deep navy field, violet accents, cool cyan/magenta charts.
    // §5 fonts Inter/Inter — bundled as-is; JetBrains Mono for the technical voice.
    name: 'nocturne',
    label: 'Nocturne',
    description: 'Dark-first, technical — deep navy with violet accents; Inter throughout.',
    fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    css: [
      '& hr { border: none; height: 1px; background: linear-gradient(90deg, transparent, var(--primary), transparent); opacity: 0.6; }',
      '& ::selection { background: var(--primary); color: var(--primary-foreground); }',
      '& blockquote { border-left: 1px solid var(--primary); padding-left: 1.25rem; }',
    ].join('\n'),
    cssVars: {
      '--radius': '0.5rem',
      '--background': 'oklch(0.18 0.035 265)',
      '--foreground': 'oklch(0.94 0.015 270)',
      '--card': 'oklch(0.22 0.04 265)',
      '--card-foreground': 'oklch(0.94 0.015 270)',
      '--popover': 'oklch(0.22 0.04 265)',
      '--popover-foreground': 'oklch(0.94 0.015 270)',
      '--primary': 'oklch(0.72 0.16 290)',
      '--primary-foreground': 'oklch(0.18 0.035 265)',
      '--secondary': 'oklch(0.27 0.04 268)',
      '--secondary-foreground': 'oklch(0.94 0.015 270)',
      '--muted': 'oklch(0.27 0.04 268)',
      '--muted-foreground': 'oklch(0.68 0.03 270)',
      '--accent': 'oklch(0.3 0.06 285)',
      '--accent-foreground': 'oklch(0.95 0.015 270)',
      '--destructive': 'oklch(0.65 0.19 15)',
      '--destructive-foreground': 'oklch(0.96 0.01 270)',
      '--border': 'oklch(0.93 0.02 270 / 12%)',
      '--input': 'oklch(0.93 0.02 270 / 15%)',
      '--ring': 'oklch(0.72 0.16 290)',
      '--chart-1': 'oklch(0.62 0.16 290)',
      '--chart-2': 'oklch(0.66 0.12 205)',
      '--chart-3': 'oklch(0.55 0.16 345)',
      '--chart-4': 'oklch(0.64 0.12 160)',
      '--chart-5': 'oklch(0.5 0.14 260)',
    },
  },
  {
    // Warm, soft, playful: sand field, terracotta primary, olive support, extra-round corners.
    // §5 fonts Fraunces/Figtree → Noto Serif (warm serif display) / Inter (rounded-ish sans body).
    name: 'organic',
    label: 'Organic',
    description: 'Warm, soft, playful — sage green, terracotta, leafy chart tones; Fraunces display over Figtree, extra-round corners.',
    fonts: { display: 'Noto Serif', body: 'Inter' },
    css: [
      '& hr { border: none; height: 4px; width: 4rem; margin-inline: 0; border-radius: 999px; background: var(--primary); opacity: 0.45; }',
      '& ::selection { background: color-mix(in oklab, var(--primary) 30%, transparent); }',
      '& blockquote { border-left: none; background: var(--muted); border-radius: 1.5rem; padding: 1rem 1.5rem; font-style: normal; }',
    ].join('\n'),
    cssVars: {
      '--radius': '1rem',
      '--background': 'oklch(0.965 0.018 120)',
      '--foreground': 'oklch(0.3 0.04 130)',
      '--card': 'oklch(0.985 0.012 115)',
      '--card-foreground': 'oklch(0.3 0.04 130)',
      '--popover': 'oklch(0.985 0.012 115)',
      '--popover-foreground': 'oklch(0.3 0.04 130)',
      '--primary': 'oklch(0.6 0.15 40)',
      '--primary-foreground': 'oklch(0.98 0.01 110)',
      '--secondary': 'oklch(0.9 0.05 125)',
      '--secondary-foreground': 'oklch(0.33 0.05 130)',
      '--muted': 'oklch(0.92 0.025 118)',
      '--muted-foreground': 'oklch(0.47 0.04 125)',
      '--accent': 'oklch(0.88 0.06 130)',
      '--accent-foreground': 'oklch(0.32 0.04 130)',
      '--destructive': 'oklch(0.55 0.19 28)',
      '--destructive-foreground': 'oklch(0.98 0.01 110)',
      '--border': 'oklch(0.87 0.03 118)',
      '--input': 'oklch(0.87 0.03 118)',
      '--ring': 'oklch(0.6 0.15 40)',
      '--chart-1': 'oklch(0.62 0.14 40)',
      '--chart-2': 'oklch(0.6 0.14 200)',
      '--chart-3': 'oklch(0.64 0.12 87)',
      '--chart-4': 'oklch(0.47 0.11 140)',
      '--chart-5': 'oklch(0.58 0.11 350)',
    },
  },
  {
    // Newspaper/report: paper white, ink text, steel-blue accents, tight radius.
    // §5 font Source Serif 4 → Noto Serif (the bundled serif) for display AND body.
    name: 'broadsheet',
    label: 'Broadsheet',
    description: 'Newspaper/report — paper white, ink, steel blue; Source Serif 4.',
    fonts: { display: 'Noto Serif', body: 'Noto Serif' },
    css: [
      '& hr { border: none; height: 3px; border-top: 1px solid var(--foreground); border-bottom: 1px solid var(--foreground); background: transparent; }',
      '& ::selection { background: color-mix(in oklab, var(--primary) 25%, transparent); }',
      '& th { text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.85em; }',
    ].join('\n'),
    cssVars: {
      '--radius': '0.25rem',
      '--background': 'oklch(0.985 0.003 95)',
      '--foreground': 'oklch(0.22 0.01 260)',
      '--card': 'oklch(1 0 0)',
      '--card-foreground': 'oklch(0.22 0.01 260)',
      '--popover': 'oklch(1 0 0)',
      '--popover-foreground': 'oklch(0.22 0.01 260)',
      '--primary': 'oklch(0.45 0.09 245)',
      '--primary-foreground': 'oklch(0.98 0.003 95)',
      '--secondary': 'oklch(0.94 0.005 95)',
      '--secondary-foreground': 'oklch(0.25 0.01 260)',
      '--muted': 'oklch(0.95 0.005 95)',
      '--muted-foreground': 'oklch(0.45 0.01 260)',
      '--accent': 'oklch(0.92 0.02 245)',
      '--accent-foreground': 'oklch(0.25 0.01 260)',
      '--destructive': 'oklch(0.52 0.2 27)',
      '--destructive-foreground': 'oklch(0.98 0.003 95)',
      '--border': 'oklch(0.87 0.005 95)',
      '--input': 'oklch(0.87 0.005 95)',
      '--ring': 'oklch(0.45 0.09 245)',
      '--chart-1': 'oklch(0.5 0.1 245)',
      '--chart-2': 'oklch(0.3 0.01 260)',
      '--chart-3': 'oklch(0.6 0.01 260)',
      '--chart-4': 'oklch(0.55 0.14 25)',
      '--chart-5': 'oklch(0.7 0.06 80)',
    },
  },
  {
    // Professional, square: slate neutrals, industrial blue, a safety-orange chart accent.
    // §5 fonts Barlow Condensed/Barlow → Inter/Inter (no condensed grotesque bundled); JetBrains Mono for figures.
    name: 'industry',
    label: 'Industry',
    description: 'Professional, square — slate and industrial blue; Barlow Condensed display over Barlow.',
    fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    css: [
      '& hr { border: none; height: 1px; background: repeating-linear-gradient(90deg, var(--foreground) 0 6px, transparent 6px 10px); opacity: 0.5; }',
      '& ::selection { background: color-mix(in oklab, var(--primary) 30%, transparent); }',
      '& table { font-variant-numeric: tabular-nums; }',
      '& th { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.8em; }',
    ].join('\n'),
    cssVars: {
      '--radius': '0.125rem',
      '--background': 'oklch(0.975 0.004 250)',
      '--foreground': 'oklch(0.24 0.02 255)',
      '--card': 'oklch(0.995 0.002 250)',
      '--card-foreground': 'oklch(0.24 0.02 255)',
      '--popover': 'oklch(0.995 0.002 250)',
      '--popover-foreground': 'oklch(0.24 0.02 255)',
      '--primary': 'oklch(0.5 0.13 250)',
      '--primary-foreground': 'oklch(0.98 0.004 250)',
      '--secondary': 'oklch(0.93 0.008 250)',
      '--secondary-foreground': 'oklch(0.28 0.02 255)',
      '--muted': 'oklch(0.93 0.008 250)',
      '--muted-foreground': 'oklch(0.47 0.02 255)',
      '--accent': 'oklch(0.9 0.02 250)',
      '--accent-foreground': 'oklch(0.26 0.02 255)',
      '--destructive': 'oklch(0.55 0.21 28)',
      '--destructive-foreground': 'oklch(0.98 0.004 250)',
      '--border': 'oklch(0.87 0.01 250)',
      '--input': 'oklch(0.87 0.01 250)',
      '--ring': 'oklch(0.5 0.13 250)',
      '--chart-1': 'oklch(0.52 0.13 250)',
      '--chart-2': 'oklch(0.35 0.03 255)',
      '--chart-3': 'oklch(0.68 0.16 55)',
      '--chart-4': 'oklch(0.62 0.05 245)',
      '--chart-5': 'oklch(0.8 0.14 90)',
    },
  },
];

/** Registry lookup by name (undefined for unknown/null). */
export function getStoryTheme(name: string | null | undefined): StoryTheme | undefined {
  return STORY_THEMES.find(t => t.name === name);
}

/**
 * The color mode a theme is DESIGNED for, derived from its canonical `--background` lightness
 * (no declared field to drift out of sync). Themes are self-contained: a themed story renders
 * in THIS mode regardless of the app color mode — containers resolve
 * `storyThemeMode(theme) ?? content.colorMode ?? app mode`, so the surface class (iframe
 * `.dark`), chart ink, and embed chrome always match the fixed palette.
 * Undefined for unknown/absent themes (unthemed stories keep the old behavior).
 */
export function storyThemeMode(name: string | null | undefined): 'dark' | 'light' | undefined {
  const bg = getStoryTheme(name)?.cssVars['--background'];
  if (!bg) return undefined;
  const l = Number(bg.match(/oklch\(\s*([0-9.]+)/)?.[1]);
  return Number.isFinite(l) && l < 0.5 ? 'dark' : 'light';
}

const fontStack = (family: string): string =>
  `"${family}", ${FAMILY_FALLBACKS[family] ?? 'sans-serif'}`;

const varsBlock = (vars: Record<string, string>): string =>
  Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');

/**
 * Emit ALL themes' `[data-theme="<name>"]` variable + font-family blocks as one CSS string.
 * Appended AFTER the compiled utility sheet so the attribute-scoped blocks beat the
 * `:root`/`.dark` neutral defaults on document order; the story's own authored <style> blocks
 * come later still in the iframe and win over everything.
 *
 * Deliberately NO `.dark`-scoped variants: themes are SELF-CONTAINED (one canonical palette;
 * a themed story never re-skins with the app mode). The surface's light/dark class follows
 * {@link storyThemeMode} instead, keeping chart ink and embed chrome legible on the fixed palette.
 */
export function storyThemeCss(): string {
  const blocks: string[] = [
    // Paint the themed root: tokens alone leave the story transparent (the app canvas bleeds
    // through). One generic rule — the per-theme var blocks below give it each theme's values.
    '[data-theme] {\n  background-color: var(--background);\n  color: var(--foreground);\n}',
  ];
  for (const t of STORY_THEMES) {
    const sel = `[data-theme="${t.name}"]`;
    blocks.push(`${sel} {\n  font-family: ${fontStack(t.fonts.body)};\n${varsBlock(t.cssVars)}\n}`);
    blocks.push(`${sel} :is(h1, h2, h3, h4, h5, h6) {\n  font-family: ${fontStack(t.fonts.display)};\n}`);
    if (t.fonts.mono) {
      blocks.push(`${sel} :is(code, pre, kbd, samp) {\n  font-family: ${fontStack(t.fonts.mono)};\n}`);
    }
    // Structural layer: `&` is the theme-scope placeholder (see StoryTheme.css).
    if (t.css) {
      blocks.push(t.css.replaceAll('&', sel));
    }
  }
  return blocks.join('\n');
}
