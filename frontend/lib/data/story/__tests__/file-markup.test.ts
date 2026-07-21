// The agent-markup combiner: content → jsx markup → content round-trips, one uniform
// schema-driven conversion for every file type (no per-type dialect, no <props>/<jsx> split).
import { describe, it, expect } from 'vitest';
import { fileToMarkup, markupToContent } from '../file-markup';
import { getTemplateDefaults } from '../template-defaults';

describe('fileToMarkup / markupToContent — question (no wrapper, raw SQL)', () => {
  it('emits fields at top level and round-trips', () => {
    const content = {
      description: 'rev',
      query: 'SELECT m, sum(r) AS r FROM s WHERE r < 5 GROUP BY 1',
      connection_name: 'saas_metrics',
      vizSettings: { type: 'bar', xCols: ['m'], yCols: ['r'] },
      parameters: [],
    };
    const markup = fileToMarkup('question', content);
    expect(markup).not.toContain('<props>');
    expect(markup).not.toContain('<jsx>');
    expect(markup).toContain('<query>');
    expect(markup).toContain('WHERE r < 5'); // raw
    const back = markupToContent('question', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.query).toBe(content.query);
      expect(back.content.connection_name).toBe('saas_metrics');
      expect(back.content.vizSettings).toMatchObject({ type: 'bar', xCols: ['m'], yCols: ['r'] });
    }
  });

  it('round-trips the complete direct-data spreadsheet without a special codec', () => {
    const content = {
      description: 'manual input', query: '', connection_name: '',
      vizSettings: { type: 'table' }, parameters: [],
      spreadsheet: {
        version: 1,
        columns: [{ name: 'region', type: 'text' }, { name: 'revenue', type: 'number' }],
        rows: [['West', '12.5'], ['East', null]],
      },
    };
    const markup = fileToMarkup('question', content);
    const back = markupToContent('question', markup);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.content.spreadsheet).toEqual(content.spreadsheet);
  });
});

describe('markupToContent — Record-typed fields never coerce to strings', () => {
  // Every natural agent spelling of an "empty" Record field must yield a
  // schema-valid value (null for Nullable records), never the string "" —
  // parameterValues:"" wedged a draft: unpublishable AND unrepairable via markup,
  // because every empty markup form round-tripped back to "".
  const BODY = '<story><div class="s"><h1>Hi</h1></div></story>';

  it.each([
    ['paired empty', '<parameterValues></parameterValues>'],
    ['whitespace body', '<parameterValues>\n</parameterValues>'],
    ['self-closing', '<parameterValues />'],
    ['empty string literal', '<parameterValues>{""}</parameterValues>'],
  ])('empty form (%s) parses to an empty record, not ""', (_label, pv) => {
    const back = markupToContent('story', `${BODY}\n${pv}`);
    expect(back.ok, !back.ok ? back.error : '').toBe(true);
    if (back.ok) expect(back.content.parameterValues ?? {}).toEqual({});
  });

  it('child elements parse as a free-form record', () => {
    const back = markupToContent('story', `${BODY}\n<parameterValues><city>NYC</city><limit>5</limit></parameterValues>`);
    expect(back.ok, !back.ok ? back.error : '').toBe(true);
    if (back.ok) expect(back.content.parameterValues).toEqual({ city: 'NYC', limit: 5 });
  });

  it('JSON-literal escape hatch still round-trips', () => {
    const back = markupToContent('story', `${BODY}\n<parameterValues>{{"city":"NYC"}}</parameterValues>`);
    expect(back.ok, !back.ok ? back.error : '').toBe(true);
    if (back.ok) expect(back.content.parameterValues).toEqual({ city: 'NYC' });
  });
});

describe('fileToMarkup / markupToContent — story (jsx field inline)', () => {
  it('emits the HTML body inline as a <story> jsx field with <Question/> embeds', () => {
    const content = {
      description: 'launch',
      colorMode: 'dark',
      story: '<div class="story"><h1>Hi</h1><div data-question-id="1022" style="width:100%;height:460px"></div></div>',
    };
    const markup = fileToMarkup('story', content);
    expect(markup).toContain('<story><div class="story">');
    expect(markup).toContain('<Question id={1022}');       // embed inline, recognized
    expect(markup).toContain('<colorMode>dark</colorMode>');
    expect(markup).not.toContain('<jsx>');
    expect(markup).not.toContain('<assets>');              // body is the source — no assets field
    // Legacy pipeline: the existing stored content (non-empty legacy HTML) selects it.
    const back = markupToContent('story', markup, content);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.colorMode).toBe('dark');
      expect(back.content.story).toContain('data-question-id="1022"'); // parsed back to HTML
    }
  });

  it('round-trips a stored body with quoted font-family style attrs (the \\uXXXX attr lockout)', () => {
    // Stored HTML legitimately carries `style="font-family: &quot;X&quot;, serif"`. The parse side
    // decodes the entities; the serialize side must re-emit them as entities — JSON `\"` escapes
    // don't exist in JSX attribute strings, so they make the whole file unparseable and every
    // EditFile fails at the same position forever.
    const story = '<div class="story"><h1 style="font-family: &quot;Inter Display&quot;, Georgia, serif; color: #123;">Q1 Review</h1><p style="font-family: &quot;Space Mono&quot;, monospace;">All fine.</p></div>';
    const markup = fileToMarkup('story', { story });
    const back = markupToContent('story', markup, { story });
    expect(back.ok, !back.ok ? back.error : '').toBe(true);
    if (!back.ok) return;
    expect(back.content.story).toContain('&quot;Inter Display&quot;'); // stored form preserved
    // Fixpoint: a second round-trip through the edit surface is stable.
    const markup2 = fileToMarkup('story', { story: back.content.story as string });
    const back2 = markupToContent('story', markup2, { story: back.content.story as string });
    expect(back2.ok).toBe(true);
    if (back2.ok) expect(back2.content.story).toBe(back.content.story);
  });

  it('round-trips a stored body poisoned with raw braces/escaped-JSON prose (the edit-lockout repro)', () => {
    // Regression: a story whose stored HTML carries `{\"color\": \"pink\"}`-style prose made the
    // serialized markup unparseable ("Expecting Unicode escape sequence \uXXXX" at a fixed
    // position), so EVERY EditFile on the file failed and no change could ever be saved.
    const poisonedBodies = [
      '<div class="story"><p>set {\\"color\\": \\"pink\\"}</p></div>',
      '<div class="story"><p>growth {net} was 4%</p></div>',
      '<div class="story"><p>{"a": 1}</p></div>',
    ];
    for (const story of poisonedBodies) {
      const markup = fileToMarkup('story', { story });
      const back = markupToContent('story', markup, { story });
      expect(back.ok, `round-trip failed for ${story}: ${!back.ok ? back.error : ''}`).toBe(true);
      if (!back.ok) continue;
      // Healed body is stable: a second round-trip through the edit surface is a fixpoint.
      const markup2 = fileToMarkup('story', { story: back.content.story as string });
      const back2 = markupToContent('story', markup2, { story: back.content.story as string });
      expect(back2.ok).toBe(true);
      if (back2.ok) expect(back2.content.story).toBe(back.content.story);
    }
  });
});

describe('markupToContent — story authored WITHOUT the <story> wrapper (CreateFile scaffold shape)', () => {
  it('adopts loose <style> + <div> top-level markup as the story body, embeds included', () => {
    // Exactly what an agent following the skill_stories scaffold emits: a top-level <style>
    // block and one root <div>, with platform embeds — no <story> field wrapper.
    const markup = [
      '<style>{`',
      "  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&display=swap');",
      '  .story-x { --bg:#101822; color:#f7f0df; background:var(--bg); }',
      '`}</style>',
      '<div class="story-x">',
      '  <section><h1>Churn doubled.</h1><Question id={142} height="430px" /></section>',
      '</div>',
    ].join('\n');
    const back = markupToContent('story', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      const story = back.content.story as string;
      expect(story).toContain('.story-x');                    // style preserved
      expect(story).toContain('<h1>Churn doubled.</h1>');     // body preserved
      // A brand-new story is format:'jsx': the embed stays JSX source, never placeholder HTML.
      expect(back.content.format).toBe('jsx');
      expect(story).toContain('<Question id={142}');
      expect(story).not.toContain('data-question-id');
    }
  });

  it('adopts a loose body alongside recognized sibling fields', () => {
    const markup = '<description>Q3 churn story</description>\n<colorMode>dark</colorMode>\n<div class="s"><h1>Hi</h1></div>';
    const back = markupToContent('story', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.description).toBe('Q3 churn story');
      expect(back.content.colorMode).toBe('dark');
      expect(back.content.story).toContain('<h1>Hi</h1>');
    }
  });
});

describe('fileToMarkup — empty story from template default (editable scaffold)', () => {
  it('emits <story></story> as an empty tag so the agent has a body to edit, no legacy <assets>', () => {
    const content = getTemplateDefaults('story');
    const markup = fileToMarkup('story', content);
    expect(markup).toContain('<description></description>');
    expect(markup).toContain('<story></story>'); // empty body surfaced as an editable tag
    expect(markup).not.toContain('<assets'); // legacy field dropped from the default
    // Round-trips: the empty body stays an empty string (not null → no null/"" flip-flop).
    const back = markupToContent('story', markup);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.content.story).toBe('');
  });
});

describe('fileToMarkup / markupToContent — story with <Param>', () => {
  it('round-trips a <Param> embed inline + its parameterValues', async () => {
    const { extractStoryParams } = await import('../story-params');
    const content = {
      colorMode: 'dark',
      parameterValues: { city: 'NYC' },
      story: '<div class="story"><div data-param-name="city" data-param-type="text" data-param-nullable="false" data-param-source-id="5" data-param-source-col="city"></div><div data-question-id="5" style="width:100%;height:430px"></div></div>',
    };
    const markup = fileToMarkup('story', content);
    expect(markup).toContain('<Param name="city" type="text" nullable={false} id={5}'); // inline, agent-friendly
    expect(markup).toContain('<parameterValues>');
    const back = markupToContent('story', markup, content); // legacy: existing stored HTML body

    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.story).toContain('data-param-name="city"'); // placeholder preserved
      expect(back.content.parameterValues).toEqual({ city: 'NYC' });
      expect(extractStoryParams(back.content.story as string)).toEqual([
        { name: 'city', type: 'text', nullable: false, source: { questionId: 5, column: 'city' } },
      ]);
    }
  });
});

describe('fileToMarkup / markupToContent — dashboard (uniform nested, no grid)', () => {
  it('round-trips assets + layout as nested elements', () => {
    const content = {
      description: 'KPIs',
      assets: [{ type: 'question', id: 5 }],
      layout: { columns: 12, items: [{ id: 5, x: 0, y: 0, w: 12, h: 4 }] },
    };
    const markup = fileToMarkup('dashboard', content);
    expect(markup).toContain('<layout>');
    expect(markup).toContain('<columns>12</columns>');
    const back = markupToContent('dashboard', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.description).toBe('KPIs');
      expect(back.content.assets).toEqual(content.assets);
      expect((back.content.layout as { items: unknown[] }).items).toEqual(content.layout.items);
    }
  });
});

describe('fileToMarkup / markupToContent — context (flattened agent view)', () => {
  it('emits the flat knowledge view (docs/metrics/annotations, no whitelist/versions) and round-trips', () => {
    // This is the shape shapeContextForAgent produces: the live version's knowledge layer flattened.
    const content = {
      docs: [{ content: '# Sales\nrevenue where r < 5', title: 'Sales', description: 'sales docs' }],
      metrics: [{ name: 'Revenue', sql: 'SUM(orders.amount)' }],
      annotations: [{ schema: 'public', table: 'orders', description: 'one row per order' }],
    };
    const markup = fileToMarkup('context', content);
    expect(markup).toContain('<docs>');
    // whitelist is human-managed and not in the agent surface — never projected.
    expect(markup).not.toContain('<whitelist>');
    expect(markup).not.toContain('<versions>');
    expect(markup).not.toContain('<published>');
    expect(markup).toContain('revenue where r < 5'); // raw (rides in a template literal)

    const back = markupToContent('context', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.docs).toEqual(content.docs);
      expect(back.content.metrics).toEqual(content.metrics);
      expect(back.content.annotations).toEqual(content.annotations);
      expect(back.content).not.toHaveProperty('whitelist');
    }
  });
});

describe('fileToMarkup — schemaless connection (type="…")', () => {
  it('round-trips nested config with typed scalars', () => {
    const content = { type: 'postgres', config: { host: 'db', port: 5432, ssl: true } };
    const markup = fileToMarkup('connection', content);
    expect(markup).toContain('<port type="number">5432</port>');
    const back = markupToContent('connection', markup);
    expect(back.ok && back.content).toEqual(content);
  });
});

describe('fileToMarkup / markupToContent — strChild edge cases (other-issues audit)', () => {
  it('round-trips a description containing a closing brace', () => {
    // strChild's specialness test decides raw-text vs template child; `}` in JSXText position
    // must not break the parse or silently vanish.
    const content = { story: '<div class="story"><p>x</p></div>', description: 'ends with brace }' };
    const markup = fileToMarkup('story', content);
    const back = markupToContent('story', markup);
    expect(back.ok, !back.ok ? back.error : '').toBe(true);
    if (back.ok) expect(back.content.description).toBe('ends with brace }');
  });
});

// Viz-first authoring: the agent authors `<viz>` envelopes and never
// `<vizSettings>` — the schema keeps vizSettings OPTIONAL so viz-only markup is
// valid as-is (no placeholder is injected; on a rollback to the classic format,
// a file without vizSettings falls back at render time).
describe('markupToContent — vizSettings is optional (viz-first authoring)', () => {
  const VIZ = '<viz><version>2</version><source><kind>table</kind></source></viz>';

  it('a question without <vizSettings> parses clean, with NO placeholder injected', () => {
    const back = markupToContent('question', `<query>SELECT 1</query><connection_name>db</connection_name>${VIZ}`);
    expect(back.ok).toBe(true);
    if (back.ok) expect('vizSettings' in back.content).toBe(false);
  });

  it('SQL cells without <vizSettings> parse clean, with NO placeholder injected', () => {
    const markup = `<cells>
      <item><type>sql</type><id>c1</id><query>SELECT 1</query><connection_name>db</connection_name>${VIZ}</item>
      <item><type>text</type><id>c2</id><content>hello</content></item>
    </cells>`;
    const back = markupToContent('notebook', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      const cells = back.content.cells as Record<string, unknown>[];
      expect('vizSettings' in cells[0]).toBe(false);
      expect('vizSettings' in cells[1]).toBe(false);
    }
  });

  it('an authored <vizSettings> round-trips untouched', () => {
    const back = markupToContent('question',
      '<query>SELECT 1</query><connection_name>db</connection_name><vizSettings><type>bar</type><xCols><item>m</item></xCols><yCols><item>v</item></yCols></vizSettings>');
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.content.vizSettings).toEqual({ type: 'bar', xCols: ['m'], yCols: ['v'] });
  });
});

// ── New-format (`format:'jsx'`) stories — Story_Design_V2 §2/§3 ────────────────────────────
// New stories store the agent's shadcn JSX SOURCE verbatim in `content.story` with
// `format:'jsx'`; legacy stories (stored data-c HTML, no format) keep the old compile
// pipeline byte-identical. Legacy-ness derives EXCLUSIVELY from the EXISTING stored content.
describe('markupToContent / fileToMarkup — jsx-format stories', () => {
  const LEGACY_EXISTING = {
    description: null,
    story: '<div class="story"><span data-c="Pill" data-tone="bad" class="x">▼</span></div>',
  };
  const JSX_MARKUP =
    '<description>d</description>\n<story><div className="p-6">' +
    '<Card><CardHeader><CardTitle>Revenue</CardTitle></CardHeader>' +
    '<CardContent><Question id={1017} height="300px" /></CardContent></Card>' +
    '</div></story>';

  it('a NEW story (no existing content) stores the jsx source verbatim with format:"jsx"', () => {
    const back = markupToContent('story', JSX_MARKUP);
    expect(back.ok, !back.ok ? back.error : '').toBe(true);
    if (!back.ok) return;
    expect(back.content.format).toBe('jsx');
    const story = back.content.story as string;
    expect(story).toContain('<Card>');
    expect(story).toContain('<Question id={1017}');
    expect(story).not.toContain('data-question-id'); // never compiled to placeholder HTML
    expect(story).not.toContain('data-c=');
  });

  it('content → markup emits the jsx source verbatim, and the round trip is stable', () => {
    const back = markupToContent('story', JSX_MARKUP);
    if (!back.ok) throw new Error(back.error);
    const markup = fileToMarkup('story', back.content);
    expect(markup).toContain('<Card>');
    expect(markup).toContain('<Question id={1017}');
    // Second pass (edit of a jsx-format story: existing content IS the jsx content).
    const back2 = markupToContent('story', markup, back.content);
    expect(back2.ok).toBe(true);
    if (back2.ok) {
      expect(back2.content.format).toBe('jsx');
      expect(back2.content.story).toBe(back.content.story);
    }
  });

  it('a NEW story rejects legacy component names and disallowed HTML tags', () => {
    const pill = markupToContent('story', '<story><div><Pill tone="bad">x</Pill></div></story>');
    expect(pill.ok).toBe(false);
    if (!pill.ok) expect(pill.error).toContain('Pill');
    const video = markupToContent('story', '<story><div><video src="x.mp4"></video></div></story>');
    expect(video.ok).toBe(false);
    if (!video.ok) expect(video.error).toContain('video');
  });

  it('a LEGACY story (stored data-c HTML) keeps the old pipeline: components compile to HTML', () => {
    const markup =
      '<story><div data-design="tw" class="@container"><Pill tone="bad">▼ 3%</Pill>' +
      '<Question id={14} height="300px" /></div></story>';
    const back = markupToContent('story', markup, LEGACY_EXISTING);
    expect(back.ok, !back.ok ? back.error : '').toBe(true);
    if (!back.ok) return;
    expect(back.content.format).toBeUndefined(); // legacy stays legacy
    const story = back.content.story as string;
    expect(story).toContain('data-c="Pill"');
    expect(story).toContain('data-question-id="14"');
  });

  it('a plain non-empty legacy story (no data-c) is still legacy', () => {
    const existing = { description: null, story: '<div class="story"><h1>old</h1></div>' };
    const back = markupToContent('story', '<story><div class="story"><h1>new</h1></div></story>', existing);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.format).toBeUndefined();
      expect(back.content.story).toBe('<div class="story"><h1>new</h1></div>');
    }
  });

  it('legacy cannot be forged from the INCOMING markup (data-c in prose is still a new story)', () => {
    const markup = '<story><div><p>the old data-c="Pill" attribute is gone</p></div></story>';
    const back = markupToContent('story', markup);
    expect(back.ok, !back.ok ? back.error : '').toBe(true);
    if (back.ok) expect(back.content.format).toBe('jsx');
  });

  it('an existing format:"jsx" story with an empty body stays on the new pipeline', () => {
    const existing = { description: null, story: '', format: 'jsx' };
    const back = markupToContent('story', '<story><div><Badge>ok</Badge></div></story>', existing);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.format).toBe('jsx');
      expect(back.content.story).toContain('<Badge>');
    }
  });
});

// Banned-CSS sanitizer at the save boundary (Story_Design_V2 §4): where markup becomes content,
// a format:'jsx' story's <style> blocks and inline styles are stripped of position:fixed/sticky
// and every external-fetch construct (url()/src()/@import; only data: URIs pass). Legacy stories
// are FROZEN — their @import fonts stay live, so the legacy path is never sanitized.
describe('markupToContent — banned CSS stripped for jsx stories, legacy left alone', () => {
  it('strips @import, external url(), and fixed/sticky from a new story body', () => {
    const markup = [
      '<style>{`',
      "@import url('https://fonts.example/css2?family=X');",
      '.hero { position: sticky; top: 0; color: red; background: url(https://evil.example/x.png); }',
      '`}</style>',
      '<div class="s"><h1 style="position:fixed;color:blue">Hi</h1></div>',
    ].join('\n');
    const back = markupToContent('story', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      const story = back.content.story as string;
      expect(story).not.toContain('@import');
      expect(story).not.toContain('evil.example');
      expect(story).not.toMatch(/position:\s*(fixed|sticky)/);
      expect(story).toContain('color: red');
      expect(story).toContain('color:blue');
      expect(story).toContain('<h1');
    }
  });

  it('keeps data: URIs in a new story body', () => {
    const markup = '<style>{`.a{background-image:url("data:image/png;base64,AAAA")}`}</style>\n<div class="s">x</div>';
    const back = markupToContent('story', markup);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.content.story as string).toContain('data:image/png;base64,AAAA');
  });

  it('legacy stories keep their @import fonts LIVE (frozen pipeline, no sanitization)', () => {
    const legacyContent = {
      story: '<div class="story" data-c="Section"><style>@import url(\'https://fonts.googleapis.com/css2?family=Lora\');</style><h1>Old</h1></div>',
    };
    const markup = fileToMarkup('story', legacyContent);
    const back = markupToContent('story', markup, legacyContent);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.format).toBeUndefined();
      expect(back.content.story as string).toContain('@import');
      expect(back.content.story as string).toContain('fonts.googleapis.com');
    }
  });
});

// StoryContent.theme (Story_Design_V2 §5): `<theme>nocturne</theme>` is a plain schema field —
// the generic codec round-trips it like colorMode, no special-casing.
describe('story <theme> field round-trip', () => {
  it('markupToContent parses <theme> into content.theme (jsx pipeline)', () => {
    const markup = '<theme>nocturne</theme>\n<story><div className="p-2"><h1>Hi</h1></div></story>';
    const back = markupToContent('story', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.theme).toBe('nocturne');
      expect(back.content.format).toBe('jsx');
    }
  });

  it('fileToMarkup emits <theme> for a jsx story content', () => {
    const markup = fileToMarkup('story', { format: 'jsx', theme: 'organic', story: '<div><h1>Hi</h1></div>' });
    expect(markup).toContain('<theme>organic</theme>');
  });
});
