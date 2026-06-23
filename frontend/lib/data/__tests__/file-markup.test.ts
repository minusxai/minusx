// The agent-markup combiner: content → markup → content round-trips per dialect.
import { describe, it, expect } from 'vitest';
import { fileToMarkup, markupToContent } from '../file-markup';
import { dashboardToJsx, jsxToDashboard } from '../dashboard-jsx';
import { parseJsx } from '@/lib/jsx';

describe('fileToMarkup / markupToContent — keyvalue (question)', () => {
  it('projects a question to <props> XML and round-trips', () => {
    const content = {
      description: 'rev',
      query: 'SELECT m, sum(r) AS r FROM s WHERE r < 5 GROUP BY 1',
      connection_name: 'saas_metrics',
      vizSettings: { type: 'bar', xCols: ['m'], yCols: ['r'] },
      parameters: [],
    };
    const markup = fileToMarkup('question', content);
    expect(markup.startsWith('<props>')).toBe(true);
    expect(markup).not.toContain('<jsx>');
    expect(markup).toContain('WHERE r < 5'); // SQL raw
    const back = markupToContent('question', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.query).toBe(content.query);
      expect(back.content.connection_name).toBe('saas_metrics');
      expect(back.content.vizSettings).toMatchObject({ type: 'bar', xCols: ['m'], yCols: ['r'] });
    }
  });
});

describe('fileToMarkup / markupToContent — jsx (story)', () => {
  it('splits the HTML body into <jsx> and metadata into <props>, round-trips', () => {
    const content = {
      description: 'launch',
      colorMode: 'dark',
      story: '<div class="story"><h1>Hi</h1><div data-question-id="1022" style="width:100%;height:460px"></div></div>',
      assets: [{ type: 'question', id: 1022 }],
    };
    const markup = fileToMarkup('story', content);
    expect(markup).toContain('<jsx>');
    expect(markup).toContain('<Question id={1022}');
    expect(markup).toContain('<colorMode>dark</colorMode>');
    const back = markupToContent('story', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.colorMode).toBe('dark');
      expect(back.content.story).toContain('data-question-id="1022"');
      expect(back.content.assets).toEqual([{ type: 'question', id: 1022 }]);
    }
  });
});

describe('dashboard body adapter', () => {
  it('round-trips positioned question embeds', () => {
    const content = {
      assets: [{ type: 'question', id: 5 }, { type: 'question', id: 9 }],
      layout: { columns: 12, items: [{ id: 5, x: 0, y: 0, w: 6, h: 4 }, { id: 9, x: 6, y: 0, w: 6, h: 4 }] },
    };
    const jsx = dashboardToJsx(content as Parameters<typeof dashboardToJsx>[0]);
    expect(jsx).toContain('<Dashboard cols={12}>');
    expect(jsx).toContain('<Question id={5} x={0} y={0} w={6} h={4} />');
    const parsed = parseJsx(jsx);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const d = jsxToDashboard(parsed.nodes as Parameters<typeof jsxToDashboard>[0]);
      expect(d.layout.items).toEqual(content.layout.items);
      expect(d.assets).toEqual(content.assets);
    }
  });

  it('round-trips through fileToMarkup/markupToContent', () => {
    const content = {
      description: 'KPIs',
      assets: [{ type: 'question', id: 5 }],
      layout: { columns: 12, items: [{ id: 5, x: 0, y: 0, w: 12, h: 4 }] },
    };
    const markup = fileToMarkup('dashboard', content);
    const back = markupToContent('dashboard', markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content.description).toBe('KPIs');
      expect(back.content.assets).toEqual(content.assets);
      expect((back.content.layout as { items: unknown[] }).items).toEqual(content.layout.items);
    }
  });
});

describe('fileToMarkup — keyvalue (schemaless connection)', () => {
  it('projects nested config to XML and back', () => {
    const content = { type: 'postgres', config: { host: 'db', port: 5432, ssl: true } };
    const markup = fileToMarkup('connection', content);
    expect(markup).toContain('<type>postgres</type>');
    expect(markup).toContain('<port>5432</port>');
    const back = markupToContent('connection', markup);
    expect(back.ok && back.content).toEqual(content);
  });
});
