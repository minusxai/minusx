// The agent-markup combiner: content → jsx markup → content round-trips, one uniform
// schema-driven conversion for every file type (no per-type dialect, no <props>/<jsx> split).
import { describe, it, expect } from 'vitest';
import { fileToMarkup, markupToContent } from '../file-markup';

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
    const back = markupToContent('story', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.colorMode).toBe('dark');
      expect(back.content.story).toContain('data-question-id="1022"'); // parsed back to HTML
    }
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
    const back = markupToContent('story', markup);
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
