import { renderChartToSvg } from '@/lib/chart/render-chart';
import type { QueryResult } from '@/lib/types';
import type { VizSettings } from '@/lib/types.gen';

const SAMPLE_ROWS = [
  { month: 'Jan', revenue: 100, cost: 40 },
  { month: 'Feb', revenue: 200, cost: 80 },
  { month: 'Mar', revenue: 150, cost: 60 },
];

const SAMPLE_QUERY_RESULT: QueryResult = {
  columns: ['month', 'revenue', 'cost'],
  types: ['VARCHAR', 'INTEGER', 'INTEGER'],
  rows: SAMPLE_ROWS,
};

describe('renderChartToSvg', () => {
  describe('bar chart', () => {
    it('renders a valid SVG string', () => {
      const vizSettings: VizSettings = {
        type: 'bar',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('renders with multiple y columns', () => {
      const vizSettings: VizSettings = {
        type: 'bar',
        xCols: ['month'],
        yCols: ['revenue', 'cost'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
    });
  });

  describe('line chart', () => {
    it('renders a valid SVG string', () => {
      const vizSettings: VizSettings = {
        type: 'line',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });
  });

  describe('pie chart', () => {
    it('renders a valid SVG string', () => {
      const vizSettings: VizSettings = {
        type: 'pie',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
    });
  });

  describe('funnel chart', () => {
    it('renders a valid SVG string', () => {
      const vizSettings: VizSettings = {
        type: 'funnel',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
    });
  });

  describe('waterfall chart', () => {
    it('renders a valid SVG string', () => {
      const vizSettings: VizSettings = {
        type: 'waterfall',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
    });
  });

  describe('radar chart', () => {
    it('renders a valid SVG string', () => {
      const vizSettings: VizSettings = {
        type: 'radar',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('renders with multiple y columns', () => {
      const vizSettings: VizSettings = {
        type: 'radar',
        xCols: ['month'],
        yCols: ['revenue', 'cost'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
    });
  });

  describe('area chart', () => {
    it('renders a valid SVG string', () => {
      const vizSettings: VizSettings = {
        type: 'area',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
    });
  });

  describe('options', () => {
    it('accepts custom width and height', () => {
      const vizSettings: VizSettings = {
        type: 'bar',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings, {
        width: 1200,
        height: 600,
      });
      expect(svg).toContain('width="1200"');
      expect(svg).toContain('height="600"');
    });

    it('supports dark and light color modes', () => {
      const vizSettings: VizSettings = {
        type: 'bar',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const darkSvg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings, { colorMode: 'dark' });
      const lightSvg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings, { colorMode: 'light' });
      // Both should render valid SVGs
      expect(darkSvg).toContain('<svg');
      expect(lightSvg).toContain('<svg');
      // Dark uses light text (#8B949E), light uses dark text — they should differ
      expect(darkSvg).not.toBe(lightSvg);
    });
  });

  describe('unsupported types', () => {
    it('returns null for table type', () => {
      const vizSettings: VizSettings = {
        type: 'table',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toBeNull();
    });

    it('returns null for pivot type', () => {
      const vizSettings: VizSettings = {
        type: 'pivot',
        xCols: [],
        yCols: [],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null for empty rows', () => {
      const emptyResult: QueryResult = {
        columns: ['month', 'revenue'],
        types: ['VARCHAR', 'INTEGER'],
        rows: [],
      };
      const vizSettings: VizSettings = {
        type: 'bar',
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(emptyResult, vizSettings);
      expect(svg).toBeNull();
    });

    it('returns null when no yCols specified', () => {
      const vizSettings: VizSettings = {
        type: 'bar',
        xCols: ['month'],
        yCols: [],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toBeNull();
    });
  });
});
