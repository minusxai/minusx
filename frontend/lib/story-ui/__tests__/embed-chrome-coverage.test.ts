/**
 * Compile-coverage guarantee for the story embed WRAPPER chrome (staging regression, Jul 2026).
 *
 * The story iframe's only stylesheet is the compiled story CSS (recipe union = kit +
 * EMBED_CHROME_FILES ∪ per-story authored candidates). Any component that renders chrome
 * INSIDE the iframe must therefore be in EMBED_CHROME_FILES, or its Tailwind classes silently
 * miss the sheet and the chrome renders unstyled (the collapsed-embed bug). These three files
 * were the gap: their wrappers were Chakra Boxes (emotion — a channel that never reaches the
 * iframe), and once converted to Tailwind they MUST be part of the recipe extraction.
 */
import { describe, it, expect } from 'vitest';
import { EMBED_CHROME_FILES } from '../../../scripts/generate-story-ui-classes';
import { STORY_UI_RECIPE_CLASSES } from '../recipe-classes';

const REQUIRED_FILES = [
  'components/views/shared/StoryJsxBody.tsx',
  'components/views/shared/StoryEmbeds.tsx',
  'components/views/story/InlineNumber.tsx',
];

describe('embed wrapper chrome is covered by the story CSS compile', () => {
  it('EMBED_CHROME_FILES includes every file that renders wrapper chrome inside the iframe', () => {
    for (const f of REQUIRED_FILES) {
      expect(EMBED_CHROME_FILES.some((p) => p.endsWith(f)), `${f} missing from EMBED_CHROME_FILES`).toBe(true);
    }
  });

  it('the generated recipe union carries the wrapper token classes', () => {
    // Card chrome (both embed paths) and the InlineNumber footnote frame/panel.
    for (const cls of ['bg-card', 'border-border', 'h-[260px]', 'w-[420px]']) {
      expect(STORY_UI_RECIPE_CLASSES, `${cls} missing from recipe classes`).toContain(cls);
    }
  });
});
