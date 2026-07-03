import { describe, it, expect } from 'vitest';
import { gridTrackCount, spanFromGridColumn, parseTopLevelClassRules, scanStoryLayout } from '../deterministic/story-layout';

describe('gridTrackCount', () => {
  it('reads repeat(N, …)', () => {
    expect(gridTrackCount('repeat(3, 1fr)')).toBe(3);
    expect(gridTrackCount('repeat(2,minmax(0,1fr))')).toBe(2);
  });
  it('counts an explicit track list', () => {
    expect(gridTrackCount('1fr 1fr 1fr')).toBe(3);
    expect(gridTrackCount('200px 1fr')).toBe(2);
    expect(gridTrackCount('1fr')).toBe(1);
  });
  it('returns 0 (unknown) for auto-fill/auto-fit and empty', () => {
    expect(gridTrackCount('repeat(auto-fill, minmax(200px, 1fr))')).toBe(0);
    expect(gridTrackCount('')).toBe(0);
    expect(gridTrackCount(undefined)).toBe(0);
  });
});

describe('spanFromGridColumn', () => {
  it('reads span N and start/end ranges, defaulting to 1', () => {
    expect(spanFromGridColumn('span 2')).toBe(2);
    expect(spanFromGridColumn('1 / 3')).toBe(2);
    expect(spanFromGridColumn(undefined)).toBe(1);
    expect(spanFromGridColumn('auto')).toBe(1);
  });
});

describe('parseTopLevelClassRules', () => {
  it('parses base class rules and ignores @container/@media overrides', () => {
    const css = `.g{display:grid;grid-template-columns:repeat(3,1fr)}
      @container story (max-width:600px){ .g{grid-template-columns:1fr} }`;
    const rules = parseTopLevelClassRules(css);
    expect(rules.g?.display).toBe('grid');
    expect(rules.g?.gridTemplateColumns).toBe('repeat(3,1fr)');
  });
  it('maps the rightmost class in a descendant selector', () => {
    const rules = parseTopLevelClassRules('.story .card{max-width:280px}');
    expect(rules.card?.maxWidth).toBe('280px');
  });
});

describe('scanStoryLayout', () => {
  it('divides width by the grid track count for inline-viz embeds', () => {
    const jsx = `<div><style>{\`.g{display:grid;grid-template-columns:repeat(3,1fr)}\`}</style>
      <div class="g">
        <Question viz={{type:"line"}} query={\`SELECT 1\`} connection="duckdb" height="300px" />
        <Question viz={{type:"bar"}} query={\`SELECT 2\`} connection="duckdb" height="300px" />
      </div></div>`;
    const scan = scanStoryLayout(jsx, parseTopLevelClassRules('.g{display:grid;grid-template-columns:repeat(3,1fr)}'));
    expect(scan.embeds).toHaveLength(2);
    expect(scan.embeds[0].vizType).toBe('line');
    expect(scan.embeds[0].fraction).toBeCloseTo(1 / 3, 5);
  });

  it('keeps a single-column embed at full width', () => {
    const jsx = `<div><Question viz={{type:"line"}} query={\`SELECT 1\`} connection="duckdb" /></div>`;
    const scan = scanStoryLayout(jsx, {});
    expect(scan.embeds[0].fraction).toBeCloseTo(1, 5);
  });

  it('records a fixed px width from a wrapper', () => {
    const jsx = `<div style={{width:"300px"}}><Question viz={{type:"bar"}} query={\`SELECT 1\`} connection="duckdb" /></div>`;
    const scan = scanStoryLayout(jsx, {});
    expect(scan.embeds[0].minPx).toBe(300);
  });

  it('collects declared params and per-embed referenced/local params', () => {
    const jsx = `<div>
      <Param name="region" type="text" />
      <Question viz={{type:"bar"}} query={\`SELECT x FROM t WHERE r = :region AND m = :month\`} connection="duckdb" params={[{name:"month",type:"date"}]} />
    </div>`;
    const scan = scanStoryLayout(jsx, {});
    expect(scan.declaredParams).toContain('region');
    expect(scan.paramRefs[0].refs.sort()).toEqual(['month', 'region']);
    expect(scan.paramRefs[0].local).toEqual(['month']);
  });
});
