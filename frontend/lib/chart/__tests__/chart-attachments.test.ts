/**
 * chart-attachments — S3 URL cache lifecycle tests
 *
 * Verifies:
 *  1. First Send renders AND uploads
 *  2. Second Send returns cached S3 URL (no render, no upload)
 *  3. Data refresh (new updatedAt) invalidates cache — re-renders and re-uploads
 *  4. Non-chart pages (explore / folder / table viz) return []
 *  5. Dashboard produces one attachment per renderable chart, skipping non-chart types
 */

jest.mock('@/lib/chart/ChartImageRenderer.client', () => ({
  clientChartImageRenderer: {
    renderCharts: jest.fn(),
  },
}));

jest.mock('@/lib/object-store/client', () => ({
  uploadFile: jest.fn(),
}));

jest.mock('@/lib/chart/render-chart-svg', () => ({
  RENDERABLE_CHART_TYPES: new Set(['bar', 'line', 'area', 'scatter', 'pie', 'funnel', 'waterfall', 'radar']),
}));

import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';
import { uploadFile } from '@/lib/object-store/client';
import { buildChartAttachments, clearChartCaches } from '@/lib/chart/chart-attachments';
import type { AppState } from '@/lib/appState';
import type { QueryResult as ReduxQueryResult } from '@/store/queryResultsSlice';

// ---- helpers ----------------------------------------------------------------

const MOCK_DATA_URL = 'data:image/jpeg;base64,abc123';
const MOCK_PUBLIC_URL = 'https://s3.example.com/charts/xyz.jpg';

const mockRenderCharts = clientChartImageRenderer.renderCharts as jest.Mock;
const mockUploadFile = uploadFile as jest.Mock;

function makeAppState(overrides?: {
  type?: string;
  queryResultId?: string;
  vizType?: string;
  name?: string;
}): AppState {
  const {
    type = 'question',
    queryResultId = 'qr-hash-001',
    vizType = 'bar',
    name = 'Revenue Chart',
  } = overrides ?? {};

  return {
    type: 'file',
    state: {
      fileState: {
        id: 1,
        name,
        path: '/org/Revenue Chart',
        type: type as any,
        isDirty: false,
        queryResultId: type === 'question' ? queryResultId : undefined,
        content: { vizSettings: { type: vizType, xCols: ['month'], yCols: ['revenue'] }, sql: 'SELECT 1' } as any,
      },
      references: [],
      queryResults: [],
    },
  };
}

function makeQueryResultsMap(queryResultId = 'qr-hash-001', updatedAt = 1000): Record<string, ReduxQueryResult> {
  return {
    [queryResultId]: {
      query: 'SELECT 1',
      params: {},
      database: 'test',
      data: { columns: ['month', 'revenue'], types: ['varchar', 'number'], rows: [['Jan', 100]] },
      updatedAt,
      loading: false,
      error: null,
    },
  };
}

// ---- setup ------------------------------------------------------------------

beforeEach(() => {
  clearChartCaches();
  jest.clearAllMocks();

  mockRenderCharts.mockResolvedValue([{ label: 'Revenue Chart', dataUrl: MOCK_DATA_URL }]);
  mockUploadFile.mockResolvedValue({ publicUrl: MOCK_PUBLIC_URL });

  // fetch(dataUrl).then(res => res.blob()) used inside buildChartAttachments
  global.fetch = jest.fn().mockResolvedValue({
    blob: () => Promise.resolve(new Blob(['fake'], { type: 'image/jpeg' })),
  }) as any;
});

// ---- tests ------------------------------------------------------------------

describe('first Send', () => {
  it('renders and uploads, returns attachment with S3 URL', async () => {
    const attachments = await buildChartAttachments(makeAppState(), makeQueryResultsMap(), 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      type: 'image',
      content: MOCK_PUBLIC_URL,
      metadata: { auto: true },
    });
  });
});

describe('second Send (cache hit)', () => {
  it('returns cached S3 URL without render or upload', async () => {
    const appState = makeAppState();
    const qrMap = makeQueryResultsMap();

    await buildChartAttachments(appState, qrMap, 'dark'); // first: render + upload
    const attachments = await buildChartAttachments(appState, qrMap, 'dark'); // second: cache hit

    // Exactly 1 render and 1 upload across both sends
    expect(mockRenderCharts).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    expect(attachments[0].content).toBe(MOCK_PUBLIC_URL);
  });
});

describe('cache invalidation on data refresh', () => {
  it('re-renders and re-uploads when updatedAt changes', async () => {
    const appState = makeAppState();

    await buildChartAttachments(appState, makeQueryResultsMap('qr-hash-001', 1000), 'dark');

    const newUrl = 'https://s3.example.com/charts/new.jpg';
    mockRenderCharts.mockResolvedValue([{ label: 'Revenue Chart', dataUrl: MOCK_DATA_URL }]);
    mockUploadFile.mockResolvedValue({ publicUrl: newUrl });

    const attachments = await buildChartAttachments(appState, makeQueryResultsMap('qr-hash-001', 2000), 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(2);
    expect(mockUploadFile).toHaveBeenCalledTimes(2);
    expect(attachments[0].content).toBe(newUrl);
  });

  it('colorMode change produces a separate cache entry', async () => {
    const appState = makeAppState();
    const qrMap = makeQueryResultsMap();

    await buildChartAttachments(appState, qrMap, 'dark');
    await buildChartAttachments(appState, qrMap, 'light');

    // Different colorMode → different cache key → both render + upload
    expect(mockRenderCharts).toHaveBeenCalledTimes(2);
    expect(mockUploadFile).toHaveBeenCalledTimes(2);
  });
});

describe('non-renderable pages', () => {
  it('returns [] for explore page (null appState)', async () => {
    const result = await buildChartAttachments(null, {}, 'dark');
    expect(result).toEqual([]);
    expect(mockRenderCharts).not.toHaveBeenCalled();
  });

  it('returns [] for table viz type', async () => {
    const result = await buildChartAttachments(makeAppState({ vizType: 'table' }), makeQueryResultsMap(), 'dark');
    expect(result).toEqual([]);
    expect(mockRenderCharts).not.toHaveBeenCalled();
  });

  it('returns [] when queryResult not yet loaded', async () => {
    const result = await buildChartAttachments(makeAppState({ queryResultId: 'not-in-map' }), {}, 'dark');
    expect(result).toEqual([]);
  });
});

describe('dashboard with multiple charts', () => {
  it('renders one attachment per renderable chart, skips table type', async () => {
    const dashboardAppState: AppState = {
      type: 'file',
      state: {
        fileState: {
          id: 10,
          name: 'My Dashboard',
          path: '/org/My Dashboard',
          type: 'dashboard',
          isDirty: false,
          content: {} as any,
        },
        references: [
          {
            id: 1, name: 'Chart A', path: '/org/Chart A', type: 'question', isDirty: false,
            queryResultId: 'qr-a',
            content: { vizSettings: { type: 'bar', xCols: ['x'], yCols: ['y'] } } as any,
          },
          {
            id: 2, name: 'Chart B', path: '/org/Chart B', type: 'question', isDirty: false,
            queryResultId: 'qr-b',
            content: { vizSettings: { type: 'line', xCols: ['x'], yCols: ['y'] } } as any,
          },
          {
            id: 3, name: 'Table C', path: '/org/Table C', type: 'question', isDirty: false,
            queryResultId: 'qr-c',
            content: { vizSettings: { type: 'table', xCols: [], yCols: [] } } as any,
          },
        ],
        queryResults: [],
      },
    };

    const qrMap: Record<string, ReduxQueryResult> = {
      'qr-a': { query: 'S1', params: {}, database: 'test', data: { columns: ['x', 'y'], types: ['varchar', 'number'], rows: [['a', 1]] }, updatedAt: 1000, loading: false, error: null },
      'qr-b': { query: 'S2', params: {}, database: 'test', data: { columns: ['x', 'y'], types: ['varchar', 'number'], rows: [['b', 2]] }, updatedAt: 1000, loading: false, error: null },
      'qr-c': { query: 'S3', params: {}, database: 'test', data: { columns: ['x', 'y'], types: ['varchar', 'number'], rows: [['c', 3]] }, updatedAt: 1000, loading: false, error: null },
    };

    mockRenderCharts
      .mockResolvedValueOnce([{ label: 'Chart A', dataUrl: 'data:image/jpeg;base64,aaa' }])
      .mockResolvedValueOnce([{ label: 'Chart B', dataUrl: 'data:image/jpeg;base64,bbb' }]);
    mockUploadFile
      .mockResolvedValueOnce({ publicUrl: 'https://s3.example.com/a.jpg' })
      .mockResolvedValueOnce({ publicUrl: 'https://s3.example.com/b.jpg' });

    const attachments = await buildChartAttachments(dashboardAppState, qrMap, 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(2); // Chart A + B; table skipped
    expect(mockUploadFile).toHaveBeenCalledTimes(2);
    expect(attachments).toHaveLength(2);
    expect(attachments.map(a => a.content)).toEqual([
      'https://s3.example.com/a.jpg',
      'https://s3.example.com/b.jpg',
    ]);
    expect(attachments.every(a => a.metadata?.auto === true)).toBe(true);
  });
});
