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
    const tokens = scoreStory(makeStory({ story })).find((x) => x.ruleId === 'story.no-design-tokens');
    expect(tokens?.severity).toBe('warn');
    expect(tokens?.deduction).toBe(0.5);
  });

  it('flags a story with too many colors', () => {
    const colors = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999', '#aaaaaa', '#bbbbbb', '#cccccc'];
    const story = `<div class="story"><style>{\`.story{font-family:Inter;${colors.map((c, i) => `.c${i}{color:${c}}`).join(' ')}\`}</style><h1>T</h1><Question id={7} /></div>`;
    const colorsFinding = scoreStory(makeStory({ story })).find((x) => x.ruleId === 'story.too-many-colors');
    expect(colorsFinding?.severity).toBe('warn');
    expect(colorsFinding?.deduction).toBe(0.25);
  });

  it('flags a blank description as no-lead', () => {
    const lead = scoreStory(makeStory({ description: '' })).find((x) => x.ruleId === 'story.no-lead');
    expect(lead?.severity).toBe('warn');
    expect(lead?.deduction).toBe(0.25);
  });

  it('returns no findings for a healthy story', () => {
    expect(scoreStory(makeStory())).toEqual([]);
  });

  // ── embed-too-narrow (width) ───────────────────────────────────────────────
  const grid = (cols: number, embeds: string) =>
    `<div class="story"><style>{\`.story{font-family:Inter;color:#111;background:#fff} h1{color:#2563eb} .a{color:#f59e0b} .g{display:grid;grid-template-columns:repeat(${cols},1fr)}\`}</style><h1>Finding</h1><div class="g">${embeds}</div></div>`;

  it('flags cartesian charts packed into a 3-column grid (via ctx viz types)', () => {
    const story = grid(3, `<Question id={1} /><Question id={2} /><Question id={3} />`);
    const ctx = { vizTypeByQuestionId: { 1: 'line', 2: 'bar', 3: 'area' } };
    const f = scoreStory(makeStory({ story }), ctx).find((x) => x.ruleId === 'story.embed-too-narrow');
    expect(f?.severity).toBe('error');
  });

  it('flags an inline cartesian chart in a 3-column grid without ctx', () => {
    const story = grid(3, `<Question viz={{type:"line"}} query={\`SELECT 1\`} connection="duckdb" /><Question viz={{type:"bar"}} query={\`SELECT 2\`} connection="duckdb" /><Question viz={{type:"area"}} query={\`SELECT 3\`} connection="duckdb" />`);
    expect(scoreStory(makeStory({ story })).find((x) => x.ruleId === 'story.embed-too-narrow')?.severity).toBe('error');
  });

  it('does NOT flag a cartesian chart at full column width', () => {
    const story = grid(1, `<Question id={1} />`);
    const ctx = { vizTypeByQuestionId: { 1: 'line' } };
    expect(ids(scoreStory(makeStory({ story }), ctx))).not.toContain('story.embed-too-narrow');
  });

  it('does NOT flag a pie in a 2-column grid but DOES flag it in a 4-column grid', () => {
    const two = grid(2, `<Question id={1} /><Question id={2} />`);
    const four = grid(4, `<Question id={1} /><Question id={2} /><Question id={3} /><Question id={4} />`);
    const ctx2 = { vizTypeByQuestionId: { 1: 'pie', 2: 'pie' } };
    const ctx4 = { vizTypeByQuestionId: { 1: 'pie', 2: 'pie', 3: 'pie', 4: 'pie' } };
    expect(ids(scoreStory(makeStory({ story: two }), ctx2))).not.toContain('story.embed-too-narrow');
    expect(ids(scoreStory(makeStory({ story: four }), ctx4))).toContain('story.embed-too-narrow');
  });

  it('flags a cartesian chart constrained to a fixed narrow px width', () => {
    const story = `<div class="story"><style>{\`.story{font-family:Inter;color:#111;background:#fff} h1{color:#2563eb} .a{color:#f59e0b}\`}</style><h1>T</h1><div style={{width:"300px"}}><Question viz={{type:"bar"}} query={\`SELECT 1\`} connection="duckdb" /></div></div>`;
    expect(scoreStory(makeStory({ story })).find((x) => x.ruleId === 'story.embed-too-narrow')?.severity).toBe('error');
  });

  // ── undeclared-param ───────────────────────────────────────────────────────
  const withEmbed = (embed: string, extra = '') =>
    `<div class="story"><style>{\`.story{font-family:Inter;color:#111;background:#fff} h1{color:#2563eb} .a{color:#f59e0b}\`}</style><h1>T</h1>${extra}${embed}</div>`;

  it('flags an inline query param not declared anywhere', () => {
    const story = withEmbed(`<Question viz={{type:"bar"}} query={\`SELECT x FROM t WHERE r = :region\`} connection="duckdb" />`);
    const f = scoreStory(makeStory({ story })).find((x) => x.ruleId === 'story.undeclared-param');
    expect(f?.severity).toBe('error');
    expect(f?.detail).toContain('region');
  });

  it('does NOT flag a param declared via <Param>', () => {
    const story = withEmbed(`<Question viz={{type:"bar"}} query={\`SELECT x FROM t WHERE r = :region\`} connection="duckdb" />`, `<Param name="region" type="text" />`);
    expect(ids(scoreStory(makeStory({ story })))).not.toContain('story.undeclared-param');
  });

  it('does NOT flag a param declared by the embed\'s own params prop', () => {
    const story = withEmbed(`<Question viz={{type:"bar"}} query={\`SELECT x FROM t WHERE m = :month\`} connection="duckdb" params={[{name:"month",type:"date"}]} />`);
    expect(ids(scoreStory(makeStory({ story })))).not.toContain('story.undeclared-param');
  });

  it('does NOT flag a param declared via parameterValues', () => {
    const story = withEmbed(`<Question viz={{type:"bar"}} query={\`SELECT x FROM t WHERE r = :region\`} connection="duckdb" />`);
    expect(ids(scoreStory(makeStory({ story, parameterValues: { region: 'west' } })))).not.toContain('story.undeclared-param');
  });
});
