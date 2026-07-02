import { describe, it, expect } from 'vitest';
import { scoreStory } from '../deterministic/story';
import { makeStory } from './fixtures';

const ids = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);
const STYLE5 = `<style>{\`.story{font-family:Inter;color:#111827;background:#ffffff} h1{color:#2563eb} .a{color:#f59e0b} .m{color:#6b7280}\`}</style>`;

describe('scoreStory', () => {
  it('flags a story with no live chart or number embed', () => {
    const story = `<div class="story">${STYLE5}<h1>A finding</h1><p>Only prose here.</p></div>`;
    expect(scoreStory(makeStory({ story }))?.find((x) => x.ruleId === 'story.no-evidence')?.severity).toBe('error');
  });

  it('flags a story with no headline', () => {
    const story = `<div class="story">${STYLE5}<p>Prose with <Number id={5} />.</p><Question id={7} /></div>`;
    expect(scoreStory(makeStory({ story })).find((x) => x.ruleId === 'story.no-headline')?.severity).toBe('warn');
  });

  it('flags a hardcoded factual number typed into prose', () => {
    const story = `<div class="story">${STYLE5}<h1>Revenue</h1><p>revenue grew to $4,200,000 last year.</p><Question id={7} /></div>`;
    const f = scoreStory(makeStory({ story })).find((x) => x.ruleId === 'story.typed-number');
    expect(f?.severity).toBe('warn');
    expect(f?.detail).toContain('$4,200,000');
  });

  it('does not flag a figure rendered live via <Number>', () => {
    const story = `<div class="story">${STYLE5}<h1>Revenue</h1><p>revenue grew to <Number id={9} prefix="$" /> this year.</p></div>`;
    expect(ids(scoreStory(makeStory({ story })))).not.toContain('story.typed-number');
  });

  it('flags a story with too few design tokens', () => {
    const story = `<div class="story"><style>{\`.story{color:#111}\`}</style><h1>Title</h1><Question id={7} /></div>`;
    expect(scoreStory(makeStory({ story })).find((x) => x.ruleId === 'story.no-design-tokens')?.severity).toBe('info');
  });

  it('flags a story with too many colors', () => {
    const colors = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999', '#aaaaaa', '#bbbbbb', '#cccccc'];
    const story = `<div class="story"><style>{\`.story{font-family:Inter;${colors.map((c, i) => `.c${i}{color:${c}}`).join(' ')}\`}</style><h1>T</h1><Question id={7} /></div>`;
    expect(scoreStory(makeStory({ story })).find((x) => x.ruleId === 'story.too-many-colors')?.severity).toBe('info');
  });

  it('flags a blank description as no-lead', () => {
    expect(scoreStory(makeStory({ description: '' })).find((x) => x.ruleId === 'story.no-lead')?.severity).toBe('info');
  });

  it('returns no findings for a healthy story', () => {
    expect(scoreStory(makeStory())).toEqual([]);
  });
});
