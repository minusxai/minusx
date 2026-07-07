// Story ⇄ jsx adapter: a jsx-backed story authors HTML-ish static JSX with <Question
// id={…}/> embeds. parseStoryJsx compiles it to the story HTML (Question → the
// data-question-id placeholder the existing StoryView/AgentHtml renders) + the asset ids.
import { describe, it, expect } from 'vitest';
import { parseStoryJsx, buildStoryJsx } from '../story-v2';
import { validateJsxSource } from '@/lib/jsx';

describe('parseStoryJsx', () => {
  it('compiles html, maps <Question/> to a data-question-id embed, and collects assets', () => {
    const jsx = '<div class="story"><h1>Hi</h1><Question id={1017} /></div>';
    const r = parseStoryJsx(jsx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assets).toEqual([1017]);
      expect(r.value.html).toContain('<div class="story">');
      expect(r.value.html).toContain('<h1>Hi</h1>');
      expect(r.value.html).toContain('data-question-id="1017"');
      expect(r.value.html).not.toContain('<Question');
    }
  });

  it('keeps <style> CSS (template-literal child) raw, with its { } intact', () => {
    const jsx = '<div><style>{`.story{color:red}`}</style><p>x</p></div>';
    const r = parseStoryJsx(jsx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.html).toContain('<style>.story{color:red}</style>');
  });

  it('dedupes repeated embeds and errors on bad jsx', () => {
    const r = parseStoryJsx('<div><Question id={5}/><Question id={5}/></div>');
    if (r.ok) expect(r.value.assets).toEqual([5]);
    expect(parseStoryJsx('<div oops=>').ok).toBe(false);
  });

  it('maps JSX attribute names to HTML (className→class, htmlFor→for) so class selectors match', () => {
    const r = parseStoryJsx('<div className="story"><label htmlFor="x">L</label></div>');
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The CSS targets `.story` — emit real `class`, not the dead `className` attribute.
      expect(r.value.html).toContain('<div class="story">');
      expect(r.value.html).not.toContain('className');
      expect(r.value.html).toContain('<label for="x">');
    }
  });
});

describe('parseStoryJsx — inline <Question>', () => {
  it('maps an inline <Question query=… connection=… viz=…/> to a data-question-inline embed (no asset id)', () => {
    const jsx = '<div class="story"><Question query={`SELECT SUM(mrr) AS mrr FROM t WHERE m = :month`} connection="duckdb" viz={{type:"single_value",yCols:["mrr"]}} height="200px" /></div>';
    const r = parseStoryJsx(jsx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assets).toEqual([]); // inline questions are not saved-file references
      expect(r.value.html).toContain('data-question-inline');
      expect(r.value.html).toContain('height:200px');
      expect(r.value.html).not.toContain('<Question');
    }
  });
});

describe('parseStoryJsx — inline <Number>', () => {
  it('maps <Number id> and <Number query> to inline span placeholders (not chart cards)', () => {
    const jsx = '<div class="story"><p>MRR is <Number id={1026} prefix="$" style={{color:"#0a0"}} /> and growth <Number query={`SELECT g FROM t`} connection="duckdb" suffix="%" /></p></div>';
    const r = parseStoryJsx(jsx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.html).toContain('data-number-inline');
      expect(r.value.html).toContain('data-number-id="1026"');
      expect(r.value.html).toContain('<span'); // inline, not a <div> block
      expect(r.value.html).not.toContain('<Number');
    }
  });

  it('round-trips a <Number> story (jsx → html → jsx → same html)', () => {
    const jsx = '<div class="story">Latest: <Number id={1026} prefix="$" /></div>';
    const parsed = parseStoryJsx(jsx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rebuilt = buildStoryJsx({ story: parsed.value.html } as never);
    expect(validateJsxSource(rebuilt, ['Question', 'Param', 'Number'])).toEqual([]);
    const reparsed = parseStoryJsx(rebuilt);
    expect(reparsed.ok && reparsed.value.html).toBe(parsed.value.html);
  });
});

describe('buildStoryJsx', () => {
  it('round-trips an agent-authored story (jsx → content → jsx → same html)', () => {
    const jsx = '<div class="story"><style>{`.s{color:blue}`}</style><h2>T</h2><Question id={42} /></div>';
    const parsed = parseStoryJsx(jsx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rebuilt = buildStoryJsx({ story: parsed.value.html, assets: parsed.value.assets.map((id) => ({ id, type: 'question' })) } as never);
    expect(validateJsxSource(rebuilt, ['Question'])).toEqual([]);
    const reparsed = parseStoryJsx(rebuilt);
    expect(reparsed.ok && reparsed.value.html).toBe(parsed.value.html);
  });

  it('round-trips prose containing < and & (entity-escaped in the stored HTML, stable thereafter)', () => {
    // acorn-jsx DECODES entities in text (`&lt;` → `<`), so the stored HTML and the rebuilt jsx
    // must RE-escape them — otherwise a single "churn &lt; 5%" in prose corrupts the file's
    // markup and every subsequent edit of the story fails the whole-document parse.
    const jsx = '<div class="story"><h2>Churn &lt; 5% at last, R&amp;D approves</h2></div>';
    const parsed = parseStoryJsx(jsx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.html).toContain('&lt; 5%');   // stored HTML keeps the entity
    expect(parsed.value.html).toContain('R&amp;D');
    const rebuilt = buildStoryJsx({ story: parsed.value.html, assets: [] } as never);
    expect(validateJsxSource(rebuilt, ['Question'])).toEqual([]); // rebuilt jsx must still PARSE
    const reparsed = parseStoryJsx(rebuilt);
    expect(reparsed.ok && reparsed.value.html).toBe(parsed.value.html); // stable round-trip
  });

  it('round-trips prose containing { and } (entity-escaped in the stored HTML, stable thereafter)', () => {
    // A raw `{` in stored prose re-emits as a JSX expression opener, making the whole file
    // unparseable — every subsequent edit fails ("Expecting Unicode escape sequence \uXXXX"
    // when the brace is followed by a backslash). Braces must ride as entities, like < and &.
    const jsx = '<div class="story"><p>config is &#123;"color": "pink"&#125; today</p></div>';
    const parsed = parseStoryJsx(jsx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.html).toContain('&#123;"color": "pink"&#125;'); // stored HTML keeps entities
    expect(parsed.value.html).not.toMatch(/<p>[^<]*\{/); // never a raw brace in prose
    const rebuilt = buildStoryJsx({ story: parsed.value.html, assets: [] } as never);
    expect(validateJsxSource(rebuilt, ['Question'])).toEqual([]);
    const reparsed = parseStoryJsx(rebuilt);
    expect(reparsed.ok && reparsed.value.html).toBe(parsed.value.html);
  });

  it('entity-escapes braces in prose authored as a {`…`} template child (while <style> CSS stays raw)', () => {
    const jsx = '<div class="story"><style>{`.s{color:red}`}</style><p>{`literal {json} and 5 < 6`}</p></div>';
    const parsed = parseStoryJsx(jsx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.html).toContain('<style>.s{color:red}</style>'); // CSS braces untouched
    expect(parsed.value.html).toContain('literal &#123;json&#125; and 5 &lt; 6'); // prose escaped
    const rebuilt = buildStoryJsx({ story: parsed.value.html, assets: [] } as never);
    expect(validateJsxSource(rebuilt, ['Question'])).toEqual([]);
    const reparsed = parseStoryJsx(rebuilt);
    expect(reparsed.ok && reparsed.value.html).toBe(parsed.value.html);
  });

  it('HEALS stored HTML already poisoned with raw braces in prose (the \\uXXXX edit-lockout)', () => {
    // Pre-fix documents can carry raw `{`/`}` in prose text. buildStoryJsx must escape them on
    // re-emit so the file becomes editable again, instead of failing every edit forever.
    const poisoned = '<div class="story"><style>.s{color:red}</style><p>set {\\"color\\": \\"pink\\"} now</p><p>growth {net} was 4%</p><Question id={0} /><div data-question-id="7" style="width:100%;height:430px"></div></div>'
      .replace('<Question id={0} />', ''); // stored HTML never contains components — only placeholders
    const rebuilt = buildStoryJsx({ story: poisoned, assets: [] } as never);
    expect(validateJsxSource(rebuilt, ['Question'])).toEqual([]); // parses again
    expect(rebuilt).toContain('<Question id={7} />'); // placeholder conversion still works
    expect(rebuilt).toContain('{`.s{color:red}`}'); // CSS template wrap still works
    const reparsed = parseStoryJsx(rebuilt);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    // Healed content preserved (braces now as entities — render-identical in HTML).
    expect(reparsed.value.html).toContain('set &#123;\\"color\\": \\"pink\\"&#125; now');
    expect(reparsed.value.html).toContain('growth &#123;net&#125; was 4%');
    // Stable from here on: a second round-trip is a fixpoint.
    const again = parseStoryJsx(buildStoryJsx({ story: reparsed.value.html, assets: [] } as never));
    expect(again.ok && again.value.html).toBe(reparsed.value.html);
  });

  it('round-trips a story with an INLINE question (multi-line SQL with <, >, : kept raw)', () => {
    const jsx = '<div class="story"><Question query={`SELECT *\nFROM t\nWHERE rev > 100 AND a < 5 AND m = :month`} connection="duckdb" viz={{type:"single_value",yCols:["rev"]}} params={[{name:"month",type:"date",label:null,source:null}]} height="180px" /></div>';
    const parsed = parseStoryJsx(jsx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rebuilt = buildStoryJsx({ story: parsed.value.html, assets: [] } as never);
    expect(validateJsxSource(rebuilt, ['Question', 'Param'])).toEqual([]);
    const reparsed = parseStoryJsx(rebuilt);
    expect(reparsed.ok && reparsed.value.html).toBe(parsed.value.html);
  });
});
