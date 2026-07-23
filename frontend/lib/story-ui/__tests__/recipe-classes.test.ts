/**
 * Freshness guard: lib/story-ui/recipe-classes.ts is GENERATED from the component sources
 * (npm run generate-story-ui-classes). If a component changes and the file is stale, the
 * compiled base sheet silently misses recipe classes — this test fails instead.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { extractRecipeClasses, EMBED_CHROME_FILES } from '../../../scripts/generate-story-ui-classes';
import { STORY_UI_RECIPE_CLASSES } from '../recipe-classes';

describe('recipe-classes.ts freshness', () => {
  it('matches a fresh extraction from components/kit + the re-skinned embed chrome', () => {
    const fresh = extractRecipeClasses(join(__dirname, '..', '..', '..', 'components', 'kit'), EMBED_CHROME_FILES);
    expect([...STORY_UI_RECIPE_CLASSES]).toEqual(fresh);
  });
});
