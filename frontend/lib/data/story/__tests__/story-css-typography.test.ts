/**
 * Typography palette in the story CSS compile (story-css.server.ts recipe union).
 *
 * The typography toolbar applies classes by mutating the live DOM — instant feedback only works
 * if the class is ALREADY in the story's compiled stylesheet. So STORY_WYSIWYG_CLASSES must
 * be unioned into every jsx story's compile, whether or not the markup uses them yet.
 */
import { describe, it, expect } from 'vitest';

import { compileStoryCss, STORY_RECIPE_UNION } from '@/lib/data/story/story-css.server';
import { STORY_WYSIWYG_CLASSES } from '@/lib/data/story/typography';

describe('story CSS compile — typography recipe union', () => {
  it('compiles the full typography palette into a jsx story that uses none of it', async () => {
    const css = await compileStoryCss('<div className="p-4"><p>plain</p></div>', { force: true });
    expect(css).toBeTruthy();
    // Spot-check one class per group (selector present ⇒ the rule compiled).
    for (const cls of ['text-4xl', 'text-9xl', 'font-bold', 'italic', 'underline', 'text-center']) {
      expect(STORY_WYSIWYG_CLASSES).toContain(cls);
      expect(css).toContain(`.${cls}`);
    }
  });

  it('the recipe union (compile candidates + version-hash source) includes the palette', () => {
    // STORY_RECIPE_UNION feeds BOTH the compile candidate set and storyCssCompileVersion's hash
    // source — palette membership here means new classes also flip the version, so every
    // previously-saved story recompiles at read time and picks the palette up.
    for (const cls of STORY_WYSIWYG_CLASSES) expect(STORY_RECIPE_UNION).toContain(cls);
  });

  it('compiles arbitrary important picker colors from the edited story source', async () => {
    const css = await compileStoryCss(
      '<div className="text-[#ff0000]! bg-[#00ff00]!"><p>x</p></div>',
      { force: true },
    );
    expect(css).toContain('color: #ff0000 !important');
    expect(css).toContain('background-color: #00ff00 !important');
  });
});
