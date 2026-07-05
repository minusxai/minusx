/**
 * Node-side healer for a STORED `content.story` string.
 *
 * Two historical serialize bugs bloated stories on every save:
 *   1. the story was re-wrapped in a fresh `<div data-mx-story-root>` each load, and the old
 *      serialize saved that wrapper back in → the story re-nested one level deeper per save;
 *   2. inline `<Number>` popovers (eagerly mounted, portaled to the iframe body) were captured as
 *      body content → hundreds of orphan popover panels accumulated in the string.
 *
 * `healStoryHtml` undoes both by running the (now fixed) `serializeEditedStory` over the stored
 * markup, so a batch-healed file is byte-identical to what the live editor would save today.
 * jsdom-only (needs a DOM); used by the `heal-stories` backfill.
 */
import { JSDOM } from 'jsdom';
import { serializeEditedStory } from './serialize-story';

// A stored story only needs healing if it carries the wrapper or leaked Ark runtime DOM. Skipping
// clean stories avoids rewriting them just for incidental serialize reformatting.
function needsHealing(story: string): boolean {
  return story.includes('data-mx-story-root') || /data-scope=/.test(story);
}

export function healStoryHtml(story: string): { html: string; changed: boolean } {
  if (!needsHealing(story)) return { html: story, changed: false };

  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const container = doc.createElement('div');
  container.innerHTML = story;

  // serializeEditedStory scopes to [data-mx-story-root], collapses nested wrappers, strips leaked
  // [data-scope] widget DOM + injected styles, and restores placeholder markers — exactly the heal.
  const html = serializeEditedStory(container, []);
  return { html, changed: html !== story };
}
