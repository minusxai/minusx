/**
 * The story `<Grid>`/`<GridItem>` positioning classes MUST survive the per-story Tailwind
 * compile. They live as literal class strings in components/kit/grid.tsx, reach every
 * story's stylesheet through the recipe-class union (STORY_UI_RECIPE_CLASSES), and are the
 * ONLY thing positioning grid items in view mode and in captures — if the compiler ever
 * stops emitting one of these calc()/container-query utilities, grids silently collapse to
 * a stack of unpositioned divs. This pins actual CSS emission, not candidate extraction.
 */
import { compileStoryCss } from '../story-css.server';
import { STORY_UI_RECIPE_CLASSES } from '@/lib/story-ui/recipe-classes';

const GRID_STORY =
  '<div class="mx-story" data-design="tw">' +
  '<Grid><GridItem x={0} y={0} w={8} h={5}><p>alpha</p></GridItem></Grid>' +
  '</div>';

/** The load-bearing grid classes, exactly as written in components/kit/grid.tsx. */
const GRID_CLASSES = [
  'h-[calc(var(--g-rows)*var(--g-rh))]',
  'left-[calc(var(--gi-x)/var(--g-cols)*100%)]',
  'top-[calc(var(--gi-y)*var(--g-rh))]',
  'w-[calc(var(--gi-w)/var(--g-cols)*100%)]',
  'h-[calc(var(--gi-h)*var(--g-rh))]',
  '@max-2xl:static',
  '@max-2xl:w-full',
  '@max-2xl:h-auto',
  'p-[3px]',
];

describe('story grid CSS compilation', () => {
  it('every grid positioning class is in the recipe union (extractor coverage)', () => {
    for (const cls of GRID_CLASSES) {
      expect(STORY_UI_RECIPE_CLASSES).toContain(cls);
    }
  });

  it('the story compile EMITS a rule for every grid positioning class', async () => {
    const css = await compileStoryCss(GRID_STORY);
    expect(css).toBeTruthy();
    // Distinctive value fragments that only appear if the utility actually compiled
    // (Tailwind pretty-prints calc() with spaces around operators).
    expect(css).toContain('left: calc(var(--gi-x) / var(--g-cols) * 100%)');
    expect(css).toContain('top: calc(var(--gi-y) * var(--g-rh))');
    expect(css).toContain('width: calc(var(--gi-w) / var(--g-cols) * 100%)');
    expect(css).toContain('height: calc(var(--gi-h) * var(--g-rh))');
    expect(css).toContain('height: calc(var(--g-rows) * var(--g-rh))');
    // The stacking fallback compiles as a max-width container query.
    expect(css).toMatch(/@max-2xl\\:static[\s\S]{0,80}@container \(width < 42rem\)/);
    // The gutter padding.
    expect(css).toContain('padding: 3px');
  });
});
