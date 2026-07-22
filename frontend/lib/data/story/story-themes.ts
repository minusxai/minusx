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
  /** The full shadcn token contract per mode — exactly the vars TW_INPUT_JSX maps, plus --radius. */
  cssVars: { light: Record<string, string>; dark: Record<string, string> };
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
    cssVars: {
      light: {
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
      dark: {
        '--radius': '0rem',
        '--background': 'oklch(0.17 0 0)',
        '--foreground': 'oklch(0.97 0 0)',
        '--card': 'oklch(0.21 0 0)',
        '--card-foreground': 'oklch(0.97 0 0)',
        '--popover': 'oklch(0.21 0 0)',
        '--popover-foreground': 'oklch(0.97 0 0)',
        '--primary': 'oklch(0.6 0.21 27)',
        '--primary-foreground': 'oklch(0.98 0 0)',
        '--secondary': 'oklch(0.27 0 0)',
        '--secondary-foreground': 'oklch(0.97 0 0)',
        '--muted': 'oklch(0.27 0 0)',
        '--muted-foreground': 'oklch(0.7 0 0)',
        '--accent': 'oklch(0.3 0 0)',
        '--accent-foreground': 'oklch(0.97 0 0)',
        '--destructive': 'oklch(0.65 0.2 25)',
        '--destructive-foreground': 'oklch(0.98 0 0)',
        '--border': 'oklch(1 0 0 / 12%)',
        '--input': 'oklch(1 0 0 / 15%)',
        '--ring': 'oklch(0.6 0.21 27)',
        '--chart-1': 'oklch(0.6 0.21 27)',
        '--chart-2': 'oklch(0.9 0 0)',
        '--chart-3': 'oklch(0.65 0 0)',
        '--chart-4': 'oklch(0.45 0 0)',
        '--chart-5': 'oklch(0.5 0.17 27)',
      },
    },
  },
  {
    // Old-print, bookish: cream paper, sepia ink, ochre accents, gentle radius.
    // §5 fonts Cormorant Garamond/Lora → Noto Serif/Noto Serif (the one bundled serif).
    name: 'classical',
    label: 'Classical',
    description: 'Old-print, bookish — cream with ochre/sepia; Cormorant Garamond display over Lora.',
    fonts: { display: 'Noto Serif', body: 'Noto Serif' },
    cssVars: {
      light: {
        '--radius': '0.375rem',
        '--background': 'oklch(0.965 0.02 90)',
        '--foreground': 'oklch(0.28 0.03 55)',
        '--card': 'oklch(0.98 0.015 90)',
        '--card-foreground': 'oklch(0.28 0.03 55)',
        '--popover': 'oklch(0.98 0.015 90)',
        '--popover-foreground': 'oklch(0.28 0.03 55)',
        '--primary': 'oklch(0.52 0.1 65)',
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
        '--ring': 'oklch(0.52 0.1 65)',
        '--chart-1': 'oklch(0.58 0.11 70)',
        '--chart-2': 'oklch(0.42 0.06 50)',
        '--chart-3': 'oklch(0.55 0.08 110)',
        '--chart-4': 'oklch(0.55 0.12 40)',
        '--chart-5': 'oklch(0.72 0.1 85)',
      },
      dark: {
        '--radius': '0.375rem',
        '--background': 'oklch(0.23 0.02 55)',
        '--foreground': 'oklch(0.93 0.025 85)',
        '--card': 'oklch(0.27 0.025 55)',
        '--card-foreground': 'oklch(0.93 0.025 85)',
        '--popover': 'oklch(0.27 0.025 55)',
        '--popover-foreground': 'oklch(0.93 0.025 85)',
        '--primary': 'oklch(0.75 0.1 80)',
        '--primary-foreground': 'oklch(0.23 0.02 55)',
        '--secondary': 'oklch(0.32 0.03 55)',
        '--secondary-foreground': 'oklch(0.93 0.025 85)',
        '--muted': 'oklch(0.32 0.03 55)',
        '--muted-foreground': 'oklch(0.7 0.04 75)',
        '--accent': 'oklch(0.36 0.04 60)',
        '--accent-foreground': 'oklch(0.93 0.025 85)',
        '--destructive': 'oklch(0.62 0.17 30)',
        '--destructive-foreground': 'oklch(0.95 0.02 85)',
        '--border': 'oklch(0.93 0.03 85 / 15%)',
        '--input': 'oklch(0.93 0.03 85 / 18%)',
        '--ring': 'oklch(0.75 0.1 80)',
        '--chart-1': 'oklch(0.75 0.1 80)',
        '--chart-2': 'oklch(0.62 0.09 55)',
        '--chart-3': 'oklch(0.68 0.08 110)',
        '--chart-4': 'oklch(0.65 0.12 40)',
        '--chart-5': 'oklch(0.85 0.09 90)',
      },
    },
  },
  {
    // Dark-first, technical: deep navy field, violet accents, cool cyan/magenta charts.
    // §5 fonts Inter/Inter — bundled as-is; JetBrains Mono for the technical voice.
    name: 'nocturne',
    label: 'Nocturne',
    description: 'Dark-first, technical — deep navy with violet accents; Inter throughout.',
    fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    cssVars: {
      light: {
        '--radius': '0.5rem',
        '--background': 'oklch(0.975 0.005 270)',
        '--foreground': 'oklch(0.2 0.03 275)',
        '--card': 'oklch(0.99 0.003 270)',
        '--card-foreground': 'oklch(0.2 0.03 275)',
        '--popover': 'oklch(0.99 0.003 270)',
        '--popover-foreground': 'oklch(0.2 0.03 275)',
        '--primary': 'oklch(0.5 0.19 290)',
        '--primary-foreground': 'oklch(0.98 0.005 270)',
        '--secondary': 'oklch(0.94 0.015 270)',
        '--secondary-foreground': 'oklch(0.25 0.03 275)',
        '--muted': 'oklch(0.94 0.015 270)',
        '--muted-foreground': 'oklch(0.5 0.03 275)',
        '--accent': 'oklch(0.92 0.03 290)',
        '--accent-foreground': 'oklch(0.25 0.03 275)',
        '--destructive': 'oklch(0.55 0.21 15)',
        '--destructive-foreground': 'oklch(0.98 0.005 270)',
        '--border': 'oklch(0.89 0.01 270)',
        '--input': 'oklch(0.89 0.01 270)',
        '--ring': 'oklch(0.5 0.19 290)',
        '--chart-1': 'oklch(0.55 0.2 290)',
        '--chart-2': 'oklch(0.65 0.12 220)',
        '--chart-3': 'oklch(0.55 0.15 260)',
        '--chart-4': 'oklch(0.6 0.18 330)',
        '--chart-5': 'oklch(0.68 0.11 180)',
      },
      dark: {
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
        '--chart-1': 'oklch(0.72 0.16 290)',
        '--chart-2': 'oklch(0.75 0.12 220)',
        '--chart-3': 'oklch(0.62 0.15 260)',
        '--chart-4': 'oklch(0.7 0.17 330)',
        '--chart-5': 'oklch(0.75 0.11 180)',
      },
    },
  },
  {
    // Warm, soft, playful: sand field, terracotta primary, olive support, extra-round corners.
    // §5 fonts Fraunces/Figtree → Noto Serif (warm serif display) / Inter (rounded-ish sans body).
    name: 'organic',
    label: 'Organic',
    description: 'Warm, soft, playful — sand, terracotta, olive; Fraunces display over Figtree, extra-round corners.',
    fonts: { display: 'Noto Serif', body: 'Inter' },
    cssVars: {
      light: {
        '--radius': '1rem',
        '--background': 'oklch(0.97 0.015 85)',
        '--foreground': 'oklch(0.3 0.04 50)',
        '--card': 'oklch(0.99 0.01 90)',
        '--card-foreground': 'oklch(0.3 0.04 50)',
        '--popover': 'oklch(0.99 0.01 90)',
        '--popover-foreground': 'oklch(0.3 0.04 50)',
        '--primary': 'oklch(0.6 0.13 40)',
        '--primary-foreground': 'oklch(0.98 0.01 85)',
        '--secondary': 'oklch(0.9 0.045 105)',
        '--secondary-foreground': 'oklch(0.34 0.05 105)',
        '--muted': 'oklch(0.93 0.02 85)',
        '--muted-foreground': 'oklch(0.5 0.04 55)',
        '--accent': 'oklch(0.88 0.06 70)',
        '--accent-foreground': 'oklch(0.32 0.04 50)',
        '--destructive': 'oklch(0.55 0.19 28)',
        '--destructive-foreground': 'oklch(0.98 0.01 85)',
        '--border': 'oklch(0.87 0.025 80)',
        '--input': 'oklch(0.87 0.025 80)',
        '--ring': 'oklch(0.6 0.13 40)',
        '--chart-1': 'oklch(0.62 0.13 40)',
        '--chart-2': 'oklch(0.58 0.1 110)',
        '--chart-3': 'oklch(0.5 0.06 60)',
        '--chart-4': 'oklch(0.6 0.07 230)',
        '--chart-5': 'oklch(0.75 0.12 85)',
      },
      dark: {
        '--radius': '1rem',
        '--background': 'oklch(0.22 0.02 50)',
        '--foreground': 'oklch(0.95 0.015 80)',
        '--card': 'oklch(0.26 0.025 50)',
        '--card-foreground': 'oklch(0.95 0.015 80)',
        '--popover': 'oklch(0.26 0.025 50)',
        '--popover-foreground': 'oklch(0.95 0.015 80)',
        '--primary': 'oklch(0.7 0.13 45)',
        '--primary-foreground': 'oklch(0.22 0.02 50)',
        '--secondary': 'oklch(0.31 0.03 90)',
        '--secondary-foreground': 'oklch(0.95 0.015 80)',
        '--muted': 'oklch(0.3 0.025 55)',
        '--muted-foreground': 'oklch(0.7 0.03 70)',
        '--accent': 'oklch(0.35 0.05 70)',
        '--accent-foreground': 'oklch(0.95 0.015 80)',
        '--destructive': 'oklch(0.65 0.17 28)',
        '--destructive-foreground': 'oklch(0.97 0.01 80)',
        '--border': 'oklch(0.95 0.02 80 / 14%)',
        '--input': 'oklch(0.95 0.02 80 / 17%)',
        '--ring': 'oklch(0.7 0.13 45)',
        '--chart-1': 'oklch(0.7 0.13 45)',
        '--chart-2': 'oklch(0.7 0.1 110)',
        '--chart-3': 'oklch(0.62 0.06 60)',
        '--chart-4': 'oklch(0.68 0.08 230)',
        '--chart-5': 'oklch(0.82 0.11 85)',
      },
    },
  },
  {
    // Newspaper/report: paper white, ink text, steel-blue accents, tight radius.
    // §5 font Source Serif 4 → Noto Serif (the bundled serif) for display AND body.
    name: 'broadsheet',
    label: 'Broadsheet',
    description: 'Newspaper/report — paper white, ink, steel blue; Source Serif 4.',
    fonts: { display: 'Noto Serif', body: 'Noto Serif' },
    cssVars: {
      light: {
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
      dark: {
        '--radius': '0.25rem',
        '--background': 'oklch(0.2 0.01 260)',
        '--foreground': 'oklch(0.95 0.005 95)',
        '--card': 'oklch(0.24 0.012 260)',
        '--card-foreground': 'oklch(0.95 0.005 95)',
        '--popover': 'oklch(0.24 0.012 260)',
        '--popover-foreground': 'oklch(0.95 0.005 95)',
        '--primary': 'oklch(0.68 0.1 240)',
        '--primary-foreground': 'oklch(0.2 0.01 260)',
        '--secondary': 'oklch(0.28 0.012 260)',
        '--secondary-foreground': 'oklch(0.95 0.005 95)',
        '--muted': 'oklch(0.28 0.012 260)',
        '--muted-foreground': 'oklch(0.68 0.01 260)',
        '--accent': 'oklch(0.32 0.03 245)',
        '--accent-foreground': 'oklch(0.95 0.005 95)',
        '--destructive': 'oklch(0.62 0.18 27)',
        '--destructive-foreground': 'oklch(0.97 0.005 95)',
        '--border': 'oklch(0.95 0.005 95 / 12%)',
        '--input': 'oklch(0.95 0.005 95 / 15%)',
        '--ring': 'oklch(0.68 0.1 240)',
        '--chart-1': 'oklch(0.68 0.1 240)',
        '--chart-2': 'oklch(0.88 0.005 95)',
        '--chart-3': 'oklch(0.6 0.01 260)',
        '--chart-4': 'oklch(0.65 0.14 25)',
        '--chart-5': 'oklch(0.78 0.07 80)',
      },
    },
  },
  {
    // Professional, square: slate neutrals, industrial blue, a safety-orange chart accent.
    // §5 fonts Barlow Condensed/Barlow → Inter/Inter (no condensed grotesque bundled); JetBrains Mono for figures.
    name: 'industry',
    label: 'Industry',
    description: 'Professional, square — slate and industrial blue; Barlow Condensed display over Barlow.',
    fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    cssVars: {
      light: {
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
      dark: {
        '--radius': '0.125rem',
        '--background': 'oklch(0.2 0.015 255)',
        '--foreground': 'oklch(0.95 0.008 250)',
        '--card': 'oklch(0.24 0.018 255)',
        '--card-foreground': 'oklch(0.95 0.008 250)',
        '--popover': 'oklch(0.24 0.018 255)',
        '--popover-foreground': 'oklch(0.95 0.008 250)',
        '--primary': 'oklch(0.68 0.13 245)',
        '--primary-foreground': 'oklch(0.2 0.015 255)',
        '--secondary': 'oklch(0.28 0.02 255)',
        '--secondary-foreground': 'oklch(0.95 0.008 250)',
        '--muted': 'oklch(0.28 0.02 255)',
        '--muted-foreground': 'oklch(0.68 0.02 252)',
        '--accent': 'oklch(0.32 0.04 250)',
        '--accent-foreground': 'oklch(0.95 0.008 250)',
        '--destructive': 'oklch(0.64 0.18 28)',
        '--destructive-foreground': 'oklch(0.97 0.005 250)',
        '--border': 'oklch(0.95 0.01 250 / 12%)',
        '--input': 'oklch(0.95 0.01 250 / 15%)',
        '--ring': 'oklch(0.68 0.13 245)',
        '--chart-1': 'oklch(0.68 0.13 245)',
        '--chart-2': 'oklch(0.8 0.02 252)',
        '--chart-3': 'oklch(0.75 0.15 55)',
        '--chart-4': 'oklch(0.6 0.05 245)',
        '--chart-5': 'oklch(0.85 0.13 90)',
      },
    },
  },
];

/** Registry lookup by name (undefined for unknown/null). */
export function getStoryTheme(name: string | null | undefined): StoryTheme | undefined {
  return STORY_THEMES.find(t => t.name === name);
}

const fontStack = (family: string): string =>
  `"${family}", ${FAMILY_FALLBACKS[family] ?? 'sans-serif'}`;

const varsBlock = (vars: Record<string, string>): string =>
  Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');

/**
 * Emit ALL themes' `[data-theme="<name>"]` variable blocks (+ `.dark`-scoped dark variants and
 * font-family rules) as one CSS string. Appended AFTER the compiled utility sheet so the
 * attribute-scoped blocks beat the `:root`/`.dark` neutral defaults on document order; the
 * story's own authored <style> blocks come later still in the iframe and win over everything.
 *
 * Dark selectors match how AgentHtml applies the mode: `.dark` is stamped on the iframe <html>
 * (an ANCESTOR of the story root carrying data-theme), so `.dark [data-theme]` is the live
 * form; the same-element form is included for hosts that stamp the root directly.
 */
export function storyThemeCss(): string {
  const blocks: string[] = [];
  for (const t of STORY_THEMES) {
    const sel = `[data-theme="${t.name}"]`;
    blocks.push(`${sel} {\n  font-family: ${fontStack(t.fonts.body)};\n${varsBlock(t.cssVars.light)}\n}`);
    blocks.push(`${sel} :is(h1, h2, h3, h4, h5, h6) {\n  font-family: ${fontStack(t.fonts.display)};\n}`);
    if (t.fonts.mono) {
      blocks.push(`${sel} :is(code, pre, kbd, samp) {\n  font-family: ${fontStack(t.fonts.mono)};\n}`);
    }
    blocks.push(`.dark ${sel}, ${sel}.dark {\n${varsBlock(t.cssVars.dark)}\n}`);
  }
  return blocks.join('\n');
}
