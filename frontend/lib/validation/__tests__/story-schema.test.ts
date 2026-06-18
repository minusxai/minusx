/**
 * Story schema — `story` is a top-level file type whose content carries
 * `assets` (question references) and `story`, a single agent-authored HTML
 * document rendered as a scrolling data-story page. The TypeBox schema is the
 * agent-facing contract: its description must advertise the FLUID responsive
 * contract (container queries, not a fixed canvas) and the chart-embed placeholder.
 */
import { validateFileState } from '@/lib/validation/content-validators';
import { atlasSchemaNoViz } from '@/lib/validation/atlas-json-schemas';

const baseStory = { description: null, assets: [], story: null };

describe('StoryContent schema', () => {
  it('accepts an empty story file', () => {
    expect(validateFileState({ type: 'story', content: baseStory })).toBeNull();
    expect(validateFileState({ type: 'story', content: { description: null, assets: [] } })).toBeNull();
  });

  it('accepts a story with HTML embedding questions listed in assets', () => {
    const error = validateFileState({
      type: 'story',
      content: {
        description: 'Q3 growth story',
        assets: [{ type: 'question', id: 5 }],
        story: '<div style="width:1280px"><h1>Growth</h1><div data-question-id="5" style="width:1100px;height:420px"></div></div>',
      },
    });
    expect(error).toBeNull();
  });

  it('rejects a non-string story', () => {
    expect(validateFileState({
      type: 'story',
      content: { ...baseStory, story: [{ html: '<h1>nope</h1>' }] },
    })).not.toBeNull();
  });

  it('rejects a non-array assets', () => {
    expect(validateFileState({
      type: 'story',
      content: { description: null, assets: { type: 'question', id: 5 }, story: null },
    })).not.toBeNull();
  });

  it('rejects inline (non-question) assets', () => {
    expect(validateFileState({
      type: 'story',
      content: { description: null, assets: [{ type: 'text', id: 'abc', content: 'hi' }], story: null },
    })).not.toBeNull();
  });

  it('rejects a story embedding a question missing from assets', () => {
    const error = validateFileState({
      type: 'story',
      content: {
        description: null,
        assets: [{ type: 'question', id: 5 }],
        story: '<div data-question-id="7" style="width:1100px;height:420px"></div>',
      },
    });
    expect(error).toMatch(/7/);
  });

  it('advertises the fluid/responsive story contract in the agent-facing schema', () => {
    const serialized = JSON.stringify(atlasSchemaNoViz);
    expect(serialized).toContain('AtlasStoryFile');
    // Responsive contract: render fluid (not a fixed/scaled canvas) and respond
    // to the story's own width via container queries — see atlas-schemas.ts.
    expect(serialized).toContain('FLUID RESPONSIVE');
    expect(serialized).toContain('container-type:inline-size');
    expect(serialized).toContain('@container');
  });
});
