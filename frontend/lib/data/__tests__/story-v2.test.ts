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
});
