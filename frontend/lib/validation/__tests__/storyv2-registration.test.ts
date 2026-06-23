// storyv2 type is registered + its jsx body projects into a StoryContent: content.story
// is the compiled HTML (with data-question-id embeds) and assets are the embedded ids,
// so the existing story UI renders it unchanged.
import { describe, it, expect } from 'vitest';
import { validateFileState } from '../content-validators';
import { getTemplateDefaults } from '@/lib/data/template-defaults';
import { storyV2Content } from '@/lib/api/compress-augmented';
import type { DbFile } from '@/lib/types';

describe('storyv2 registration', () => {
  it('validates content against the StoryContent schema', () => {
    expect(validateFileState({ type: 'storyv2', content: getTemplateDefaults('storyv2')! })).toBeNull();
  });

  it('projects the jsx body into a StoryContent (html + assets)', () => {
    const file = {
      type: 'storyv2',
      content: { description: 'd', story: null, assets: [], colorMode: 'dark' },
      jsx: '<div class="story"><h1>Hi</h1><Question id={1017} /></div>',
    } as unknown as DbFile;

    const content = storyV2Content(file);
    expect(content.story).toContain('<h1>Hi</h1>');
    expect(content.story).toContain('data-question-id="1017"');
    expect(content.assets).toEqual([{ id: 1017, type: 'question' }]);
    expect(content.colorMode).toBe('dark');
  });
});
