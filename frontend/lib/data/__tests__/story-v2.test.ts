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
