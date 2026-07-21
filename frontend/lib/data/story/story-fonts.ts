/**
 * Platform-provided story fonts (Story_Design_V2 §4/§11 Phase 2).
 *
 * Legacy stories bring their own fonts via authored `@import` lines (frozen behavior). For jsx
 * stories the PLATFORM provides fonts: a theme registry maps theme name → font assets (family +
 * static asset URL + optional weight/style descriptors), and `getStoryFontCss` turns the active
 * theme's entries into @font-face CSS.
 *
 * Two forms of the same fonts (self-contained-document rule):
 *  - LIVE view: this CSS is injected inside the story root as a `<style data-mx-fonts>` node with
 *    plain `url()` refs — one shared, cacheable static asset per theme, no data-URI payload on
 *    every story view.
 *  - CAPTURE: the serializer (lib/story-surface/serialize) splices the data-URI form into the
 *    PARSED COPY only — the live DOM always keeps the URL form.
 *
 * Save paths must never persist the injected node: serializeEditedStory strips `[data-mx-fonts]`
 * (see INJECTED_STYLE_SELECTOR in lib/html/serialize-story.ts).
 *
 * Phase 3 extends the registry per theme; the neutral default ships the app's bundled families
 * (system font stack remains the implicit fallback for anything unlisted).
 */

/** Marker attribute of the in-root font style node (render injects it; save paths strip it). */
export const STORY_FONTS_ATTR = 'data-mx-fonts';

export interface StoryFontAsset {
  /** CSS font-family the @font-face registers. */
  family: string;
  /** Same-origin static asset URL (public/fonts). Never a data: URI in the live form. */
  url: string;
  /** font-weight descriptor (e.g. '400', '700', or a variable range '100 900'). */
  weight?: string;
  /** font-style descriptor (e.g. 'italic'). */
  style?: string;
}

/**
 * Theme registry: theme name → font assets. Phase 3 adds per-theme entries; unknown themes fall
 * back to `neutral`.
 */
export const STORY_FONT_THEMES: Record<string, readonly StoryFontAsset[]> = {
  neutral: [
    { family: 'Inter', url: '/fonts/Inter-Variable.ttf', weight: '100 900' },
    { family: 'JetBrains Mono', url: '/fonts/JetBrainsMono-Regular.ttf', weight: '400' },
    { family: 'JetBrains Mono', url: '/fonts/JetBrainsMono-Bold.ttf', weight: '700' },
    { family: 'Noto Serif', url: '/fonts/NotoSerif-Regular.ttf', weight: '400' },
    { family: 'Noto Serif', url: '/fonts/NotoSerif-Italic.ttf', weight: '400', style: 'italic' },
  ],
};

const fontFaceRule = (a: StoryFontAsset): string =>
  '@font-face {\n' +
  `  font-family: "${a.family}";\n` +
  `  src: url("${a.url}");\n` +
  (a.weight ? `  font-weight: ${a.weight};\n` : '') +
  (a.style ? `  font-style: ${a.style};\n` : '') +
  '  font-display: swap;\n' +
  '}';

/** @font-face CSS for a theme's registered assets (URL form — the live view's cacheable shape). */
export function getStoryFontCss(theme = 'neutral'): string {
  const assets = STORY_FONT_THEMES[theme] ?? STORY_FONT_THEMES.neutral;
  return assets.map(fontFaceRule).join('\n');
}
