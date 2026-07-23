/**
 * Story schema — `story` is a top-level file type whose content is a single agent-authored
 * HTML document (the `story` field) rendered as a scrolling story page. The BODY is the
 * single source of truth: there is NO `assets` field — saved-question dependencies derive from
 * its `<Question id>` embeds, inline questions live in the body. The TypeBox schema is the
 * agent-facing contract: it must advertise the FLUID responsive rules and the <Question> embeds.
 */
import { validateFileState } from '@/lib/validation/content-validators';

const baseStory = { description: null, story: null };

describe('StoryContent schema', () => {
  it('accepts an empty story file (no assets field)', () => {
    expect(validateFileState({ type: 'story', content: baseStory })).toBeNull();
    expect(validateFileState({ type: 'story', content: { description: null } })).toBeNull();
  });

  it('accepts a story whose body embeds saved AND inline questions', () => {
    const error = validateFileState({
      type: 'story',
      content: {
        description: 'Q3 growth story',
        story:
          '<div class="story"><h1>Growth</h1>' +
          '<div data-question-id="5" style="width:100%;height:420px"></div>' +
          '<div data-question-inline="{&quot;query&quot;:&quot;SELECT SUM(mrr) AS mrr FROM t&quot;,&quot;connection_name&quot;:&quot;duckdb&quot;}" style="width:100%;height:200px"></div></div>',
      },
    });
    expect(error).toBeNull();
  });

  it('does NOT require embedded questions to be declared anywhere (body is the source)', () => {
    // The old "must be in assets" cross-check is gone — a body embed alone is valid.
    expect(validateFileState({
      type: 'story',
      content: { description: null, story: '<div data-question-id="7" style="width:100%;height:420px"></div>' },
    })).toBeNull();
  });

  it('tolerates a legacy story that still carries an assets field (back-compat)', () => {
    // additionalProperties is open, so old stored stories with assets still validate.
    expect(validateFileState({
      type: 'story',
      content: { description: null, assets: [{ type: 'question', id: 5 }], story: '<div data-question-id="5"></div>' },
    })).toBeNull();
  });

  it('rejects a non-string story', () => {
    expect(validateFileState({
      type: 'story',
      content: { ...baseStory, story: [{ html: '<h1>nope</h1>' }] },
    })).not.toBeNull();
  });
});

describe('StoryContent schema — format field (jsx-format stories)', () => {
  it('accepts format:"jsx", null, and absent', () => {
    expect(validateFileState({ type: 'story', content: { ...baseStory, format: 'jsx' } })).toBeNull();
    expect(validateFileState({ type: 'story', content: { ...baseStory, format: null } })).toBeNull();
    expect(validateFileState({ type: 'story', content: baseStory })).toBeNull();
  });

  it('rejects any other format value (e.g. "html")', () => {
    expect(validateFileState({ type: 'story', content: { ...baseStory, format: 'html' } })).not.toBeNull();
    expect(validateFileState({ type: 'story', content: { ...baseStory, format: 1 } })).not.toBeNull();
  });
});

describe('StoryContent schema — template field (structural genre)', () => {
  it('accepts each named template, null, and absent', () => {
    for (const name of ['editorial', 'deck', 'brief', 'scrolly']) {
      expect(validateFileState({ type: 'story', content: { ...baseStory, format: 'jsx', template: name } })).toBeNull();
    }
    expect(validateFileState({ type: 'story', content: { ...baseStory, template: null } })).toBeNull();
    expect(validateFileState({ type: 'story', content: baseStory })).toBeNull();
  });

  it('rejects an unknown template value', () => {
    expect(validateFileState({ type: 'story', content: { ...baseStory, template: 'bogus' } })).not.toBeNull();
    expect(validateFileState({ type: 'story', content: { ...baseStory, template: 1 } })).not.toBeNull();
  });
});
