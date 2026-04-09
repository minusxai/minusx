/**
 * chart-attachments — two-level cache lifecycle tests
 *
 * Verifies:
 *  1. prewarmChartDataUrls renders but does NOT upload
 *  2. buildChartAttachments after prewarm uploads but does NOT re-render
 *  3. buildChartAttachments on second Send returns cached S3 URL (no render, no upload)
 *  4. Cold-start buildChartAttachments (no prewarm) renders AND uploads in one shot
 *  5. Data refresh (new updatedAt) invalidates both cache levels — prewarm re-renders
 *  6. Non-chart page (explore / folder / table viz) returns []
 *  7. Dashboard produces one attachment per renderable chart
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
  RENDERABLE_CHART_TYPES: new Set(['bar', 'line', 'area', 'scatter', 'pie', 'funnel', 'waterfall']),
}));

import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';
import { uploadFile } from '@/lib/object-store/client';
import {
  buildChartAttachments,
  prewarmChartDataUrls,
  clearChartCaches,
} from '@/lib/chart/chart-attachments';
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

  // fetch(dataUrl).then(res => res.blob()) used in buildChartAttachments
  global.fetch = jest.fn().mockResolvedValue({
    blob: () => Promise.resolve(new Blob(['fake'], { type: 'image/jpeg' })),
  }) as any;
});

// ---- tests ------------------------------------------------------------------

describe('prewarmChartDataUrls', () => {
  it('renders but does not upload to S3', async () => {
    const appState = makeAppState();
    const qrMap = makeQueryResultsMap();

    await prewarmChartDataUrls(appState, qrMap, 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('does not re-render on second call with the same data', async () => {
    const appState = makeAppState();
    const qrMap = makeQueryResultsMap();

    await prewarmChartDataUrls(appState, qrMap, 'dark');
    await prewarmChartDataUrls(appState, qrMap, 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(1);
  });

  it('does nothing for non-chart pages', async () => {
    const appState: AppState = { type: 'explore', state: null };
    await prewarmChartDataUrls(appState, {}, 'dark');
    expect(mockRenderCharts).not.toHaveBeenCalled();
  });
});

describe('buildChartAttachments — after prewarm (level-1 cache hit)', () => {
  it('uploads but does not re-render', async () => {
    const appState = makeAppState();
    const qrMap = makeQueryResultsMap();

    await prewarmChartDataUrls(appState, qrMap, 'dark');  // render: 1, upload: 0
    const attachments = await buildChartAttachments(appState, qrMap, 'dark'); // render: still 1, upload: 1

    // Only one render total (from prewarm), one upload total (from build)
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

describe('buildChartAttachments — second Send (level-2 cache hit)', () => {
  it('returns cached S3 URL without render or upload', async () => {
    const appState = makeAppState();
    const qrMap = makeQueryResultsMap();

    // First send: cold start → render + upload (level-2 cache populated)
    await buildChartAttachments(appState, qrMap, 'dark');
    // Second send: level-2 hit — no render, no upload
    const attachments = await buildChartAttachments(appState, qrMap, 'dark');

    // Exactly 1 render and 1 upload across both sends
    expect(mockRenderCharts).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    expect(attachments[0].content).toBe(MOCK_PUBLIC_URL);
  });
});

describe('buildChartAttachments — cold start (no prewarm)', () => {
  it('renders AND uploads in one shot', async () => {
    const appState = makeAppState();
    const qrMap = makeQueryResultsMap();

    const attachments = await buildChartAttachments(appState, qrMap, 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].content).toBe(MOCK_PUBLIC_URL);
  });
});

describe('cache invalidation on data refresh', () => {
  it('re-renders after updatedAt changes', async () => {
    const appState = makeAppState();
    const qrMapV1 = makeQueryResultsMap('qr-hash-001', 1000);
    const qrMapV2 = makeQueryResultsMap('qr-hash-001', 2000); // new updatedAt

    await prewarmChartDataUrls(appState, qrMapV1, 'dark');
    expect(mockRenderCharts).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockRenderCharts.mockResolvedValue([{ label: 'Revenue Chart', dataUrl: MOCK_DATA_URL }]);

    await prewarmChartDataUrls(appState, qrMapV2, 'dark');
    expect(mockRenderCharts).toHaveBeenCalledTimes(1); // re-rendered for new data
  });

  it('re-uploads after updatedAt changes (level-2 cache invalidated)', async () => {
    const appState = makeAppState();
    const qrMapV1 = makeQueryResultsMap('qr-hash-001', 1000);
    const qrMapV2 = makeQueryResultsMap('qr-hash-001', 2000);

    // Prime level-2 cache
    await buildChartAttachments(appState, qrMapV1, 'dark');
    jest.clearAllMocks();
    mockRenderCharts.mockResolvedValue([{ label: 'Revenue Chart', dataUrl: MOCK_DATA_URL }]);
    mockUploadFile.mockResolvedValue({ publicUrl: 'https://s3.example.com/charts/new.jpg' });

    // New data — different cache key
    const attachments = await buildChartAttachments(appState, qrMapV2, 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    expect(attachments[0].content).toBe('https://s3.example.com/charts/new.jpg');
  });
});

describe('non-renderable pages', () => {
  it('returns [] for explore page (no appState)', async () => {
    const result = await buildChartAttachments(null, {}, 'dark');
    expect(result).toEqual([]);
    expect(mockRenderCharts).not.toHaveBeenCalled();
  });

  it('returns [] for table viz type', async () => {
    const appState = makeAppState({ vizType: 'table' });
    const qrMap = makeQueryResultsMap();
    const result = await buildChartAttachments(appState, qrMap, 'dark');
    expect(result).toEqual([]);
    expect(mockRenderCharts).not.toHaveBeenCalled();
  });

  it('returns [] when queryResult not yet loaded', async () => {
    const appState = makeAppState({ queryResultId: 'qr-not-in-map' });
    const result = await buildChartAttachments(appState, {}, 'dark');
    expect(result).toEqual([]);
  });
});

describe('dashboard with multiple charts', () => {
  it('produces one attachment per renderable chart', async () => {
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
            id: 1,
            name: 'Chart A',
            path: '/org/Chart A',
            type: 'question',
            isDirty: false,
            queryResultId: 'qr-a',
            content: { vizSettings: { type: 'bar', xCols: ['x'], yCols: ['y'] } } as any,
          },
          {
            id: 2,
            name: 'Chart B',
            path: '/org/Chart B',
            type: 'question',
            isDirty: false,
            queryResultId: 'qr-b',
            content: { vizSettings: { type: 'line', xCols: ['x'], yCols: ['y'] } } as any,
          },
          {
            id: 3,
            name: 'Table C',
            path: '/org/Table C',
            type: 'question',
            isDirty: false,
            queryResultId: 'qr-c',
            content: { vizSettings: { type: 'table', xCols: [], yCols: [] } } as any,
          },
        ],
        queryResults: [],
      },
    };

    const qrMap: Record<string, ReduxQueryResult> = {
      'qr-a': { query: 'SELECT 1', params: {}, database: 'test', data: { columns: ['x', 'y'], types: ['varchar', 'number'], rows: [['a', 1]] }, updatedAt: 1000, loading: false, error: null },
      'qr-b': { query: 'SELECT 2', params: {}, database: 'test', data: { columns: ['x', 'y'], types: ['varchar', 'number'], rows: [['b', 2]] }, updatedAt: 1000, loading: false, error: null },
      'qr-c': { query: 'SELECT 3', params: {}, database: 'test', data: { columns: ['x', 'y'], types: ['varchar', 'number'], rows: [['c', 3]] }, updatedAt: 1000, loading: false, error: null },
    };

    mockRenderCharts
      .mockResolvedValueOnce([{ label: 'Chart A', dataUrl: 'data:image/jpeg;base64,aaa' }])
      .mockResolvedValueOnce([{ label: 'Chart B', dataUrl: 'data:image/jpeg;base64,bbb' }]);
    mockUploadFile
      .mockResolvedValueOnce({ publicUrl: 'https://s3.example.com/a.jpg' })
      .mockResolvedValueOnce({ publicUrl: 'https://s3.example.com/b.jpg' });

    const attachments = await buildChartAttachments(dashboardAppState, qrMap, 'dark');

    // Chart A + Chart B rendered; table (Chart C) skipped
    expect(mockRenderCharts).toHaveBeenCalledTimes(2);
    expect(mockUploadFile).toHaveBeenCalledTimes(2);
    expect(attachments).toHaveLength(2);
    expect(attachments.map(a => a.content)).toEqual([
      'https://s3.example.com/a.jpg',
      'https://s3.example.com/b.jpg',
    ]);
    expect(attachments.every(a => a.metadata?.auto === true)).toBe(true);
  });
});
