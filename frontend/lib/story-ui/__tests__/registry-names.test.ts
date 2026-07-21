/**
 * Drift guard: the names-only module (`component-names.ts`, importable by server-side
 * validation without React) must stay in exact sync with the real component registry
 * (`registry.ts`). If a component is added/removed in one place only, this fails.
 */
import { STORY_UI_COMPONENT_NAMES } from '../registry';
import { STORY_UI_COMPONENT_NAME_LIST } from '../component-names';

describe('story-ui registry ⇄ names-only module', () => {
  it('component name sets are identical (no drift)', () => {
    expect(new Set(STORY_UI_COMPONENT_NAMES)).toEqual(new Set(STORY_UI_COMPONENT_NAME_LIST));
  });
});
