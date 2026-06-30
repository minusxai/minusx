/**
 * Story schema — `story` is a top-level file type whose content is a single agent-authored
 * HTML document (the `story` field) rendered as a scrolling story page. The BODY is the
 * single source of truth: there is NO `assets` field — saved-question dependencies derive from
 * its `<Question id>` embeds, inline questions live in the body. The TypeBox schema is the
 * agent-facing contract: it must advertise the FLUID responsive rules and the <Question> embeds.
 */
import { validateFileState } from '@/lib/validation/content-validators';
import { atlasSchemaNoViz } from '@/lib/validation/atlas-json-schemas';

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

  it('advertises the fluid/responsive + live-number embed contract in the agent-facing schema', () => {
    const serialized = JSON.stringify(atlasSchemaNoViz);
    expect(serialized).toContain('AtlasStoryFile');
    expect(serialized).toContain('FLUID RESPONSIVE');
    expect(serialized).toContain('container-type:inline-size');
    expect(serialized).toContain('@container');
    // New embed model: <Question> (saved + inline) and never-hand-typed live numbers.
    expect(serialized).toContain('<Question');
    expect(serialized).toContain('NUMBERS ARE ALWAYS LIVE');
  });
});
