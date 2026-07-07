import { renderChartToSvg } from '@/lib/chart/render-chart';
import type { QueryResult } from '@/lib/types';
import type { VizSettings } from '@/lib/validation/atlas-schemas';

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

const DATE_QUERY_RESULT: QueryResult = {
  columns: ['date', 'revenue'],
  types: ['DATE', 'INTEGER'],
  rows: [
    { date: '2024-01-15', revenue: 100 },
    { date: '2024-02-20', revenue: 200 },
    { date: '2024-03-10', revenue: 150 },
  ],
};

describe('renderChartToSvg', () => {
  describe('SVG envelope smoke tests', () => {
    // Each chart type renders a valid SVG from SAMPLE_QUERY_RESULT.
    // `closing` flags the types whose original test also asserted the </svg> close tag.
    it.each([
      { type: 'bar', closing: true },
      { type: 'line', closing: true },
      { type: 'pie', closing: false },
      { type: 'funnel', closing: false },
      { type: 'waterfall', closing: false },
      { type: 'radar', closing: true },
      { type: 'area', closing: false },
    ] as const)('renders a valid SVG string for $type chart', ({ type, closing }) => {
      const vizSettings: VizSettings = {
        type,
        xCols: ['month'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
      if (closing) {
        expect(svg).toContain('</svg>');
      }
    });

    it('renders bar chart with multiple y columns', () => {
      const vizSettings: VizSettings = {
        type: 'bar',
        xCols: ['month'],
        yCols: ['revenue', 'cost'],
      };

      const svg = renderChartToSvg(SAMPLE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
    });

    it('renders a valid SVG string with a date x-axis from SQL types', () => {
      const vizSettings: VizSettings = {
        type: 'line',
        xCols: ['date'],
        yCols: ['revenue'],
      };

      const svg = renderChartToSvg(DATE_QUERY_RESULT, vizSettings);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('renders radar chart with multiple y columns', () => {
      const vizSettings: VizSettings = {
        type: 'radar',
        xCols: ['month'],
        yCols: ['revenue', 'cost'],
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

  // The feedback-image parity guarantee: what the agent styles is what the re-rendered
  // image shows. styleConfig (curated levers + echartsOverrides) must reach the SVG.
  describe('styleConfig parity', () => {
    const styled = (styleConfig: VizSettings['styleConfig']) =>
      renderChartToSvg(SAMPLE_QUERY_RESULT, {
        type: 'bar',
        xCols: ['month'],
        yCols: ['revenue', 'cost'],
        styleConfig,
      }, { titleOverride: 'T', colorMode: 'light' });

    it('renders styleConfig.background as the SVG background fill', () => {
      expect(styled({ background: '#101822' })).toContain('#101822');
    });

    it('hides the legend when styleConfig.legend.show=false', () => {
      const withLegend = styled(null);
      const withoutLegend = styled({ legend: { show: false } });
      // 'cost' appears only as a legend entry (title is overridden to 'T')
      expect(withLegend).toContain('cost');
      expect(withoutLegend).not.toContain('cost');
    });

    it('honors per-series color overrides (existing lever, previously dropped)', () => {
      expect(styled({ colors: { '0': '#ab34cd' } })).toContain('#ab34cd');
    });

    it('applies echartsOverrides last — even over the forced image background', () => {
      expect(styled({ echartsOverrides: { backgroundColor: '#123456' } })).toContain('#123456');
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
