import type { Mock, MockedFunction, MockedClass, MockInstance, Mocked } from 'vitest';
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

vi.mock('@/lib/chart/ChartImageRenderer.client', () => ({
  clientChartImageRenderer: {
    renderCharts: vi.fn(),
  },
}));

vi.mock('@/lib/chart/render-chart-svg', () => ({
  RENDERABLE_CHART_TYPES: new Set(['bar', 'line', 'area', 'scatter', 'pie', 'funnel', 'waterfall', 'radar']),
}));

// getCurrentV defaults to null (v1, upload path); a single test flips it to '2'.
vi.mock('@/lib/navigation/url-utils', () => ({ getCurrentV: vi.fn(() => null) }));

import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';
import { getCurrentV } from '@/lib/navigation/url-utils';
import { buildChartAttachments, clearChartCaches } from '@/lib/chart/chart-attachments';
import type { AppState } from '@/lib/appState';
import type { QueryResult as ReduxQueryResult } from '@/store/queryResultsSlice';

// ---- helpers ----------------------------------------------------------------

const MOCK_DATA_URL = 'data:image/jpeg;base64,abc123';
const MOCK_PUBLIC_URL = 'https://s3.example.com/charts/xyz.jpg';
const MOCK_S3_PUT_URL = 'https://s3.example.com/put-presigned';
const UPLOAD_URL_PREFIX = '/api/object-store/upload-url';

const mockRenderCharts = clientChartImageRenderer.renderCharts as Mock;

/** Count how many times fetch was called to get a presigned upload URL. */
function countUploadCalls(): number {
  return (global.fetch as Mock).mock.calls.filter(
    (args: any) => typeof args[0] === 'string' && (args[0] as string).startsWith(UPLOAD_URL_PREFIX)
  ).length;
}

/** Build a fetch mock that returns publicUrl for upload-URL requests, ok for PUT, blob for data-URL. */
function makeFetchMock(publicUrlForCall: (n: number) => string = () => MOCK_PUBLIC_URL) {
  let uploadCallIndex = 0;
  return vi.fn().mockImplementation((url: string, options?: any) => {
    if (typeof url === 'string' && url.startsWith(UPLOAD_URL_PREFIX)) {
      const publicUrl = publicUrlForCall(uploadCallIndex++);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ uploadUrl: MOCK_S3_PUT_URL, publicUrl }),
      });
    }
    if (options?.method === 'PUT') {
      return Promise.resolve({ ok: true });
    }
    // data-URL or blob fetch
    return Promise.resolve({
      blob: () => Promise.resolve(new Blob(['fake'], { type: 'image/jpeg' })),
    });
  });
}

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
  vi.clearAllMocks();

  mockRenderCharts.mockResolvedValue([{ label: 'Revenue Chart', dataUrl: MOCK_DATA_URL }]);
  global.fetch = makeFetchMock();
});

// ---- tests ------------------------------------------------------------------

describe('first Send', () => {
  it('renders and uploads, returns attachment with S3 URL', async () => {
    const attachments = await buildChartAttachments(makeAppState(), makeQueryResultsMap(), 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(1);
    expect(countUploadCalls()).toBe(1);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      type: 'image',
      content: MOCK_PUBLIC_URL,
      metadata: { auto: true },
    });
  });
});

describe('v2 chat (base64, no upload)', () => {
  it('returns the rendered base64 data URL directly and does NOT upload', async () => {
    (getCurrentV as Mock).mockReturnValue('2');
    try {
      const attachments = await buildChartAttachments(makeAppState(), makeQueryResultsMap(), 'dark');
      expect(mockRenderCharts).toHaveBeenCalledTimes(1);
      expect(countUploadCalls()).toBe(0); // no S3 upload
      expect(attachments[0]).toMatchObject({
        type: 'image',
        content: MOCK_DATA_URL, // inline base64, not an S3 URL
        metadata: { auto: true },
      });
    } finally {
      (getCurrentV as Mock).mockReturnValue(null);
    }
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
    expect(countUploadCalls()).toBe(1);
    expect(attachments[0].content).toBe(MOCK_PUBLIC_URL);
  });
});

describe('cache invalidation on data refresh', () => {
  it('re-renders and re-uploads when updatedAt changes', async () => {
    const appState = makeAppState();
    const newUrl = 'https://s3.example.com/charts/new.jpg';
    const urls = [MOCK_PUBLIC_URL, newUrl];
    global.fetch = makeFetchMock((i) => urls[i] ?? MOCK_PUBLIC_URL);

    await buildChartAttachments(appState, makeQueryResultsMap('qr-hash-001', 1000), 'dark');

    mockRenderCharts.mockResolvedValue([{ label: 'Revenue Chart', dataUrl: MOCK_DATA_URL }]);

    const attachments = await buildChartAttachments(appState, makeQueryResultsMap('qr-hash-001', 2000), 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(2);
    expect(countUploadCalls()).toBe(2);
    expect(attachments[0].content).toBe(newUrl);
  });

  it('colorMode change produces a separate cache entry', async () => {
    const appState = makeAppState();
    const qrMap = makeQueryResultsMap();

    await buildChartAttachments(appState, qrMap, 'dark');
    await buildChartAttachments(appState, qrMap, 'light');

    // Different colorMode → different cache key → both render + upload
    expect(mockRenderCharts).toHaveBeenCalledTimes(2);
    expect(countUploadCalls()).toBe(2);
  });
});

describe('disableAppStateImages flag', () => {
  it('returns [] without rendering or uploading when the flag is on', async () => {
    const result = await buildChartAttachments(makeAppState(), makeQueryResultsMap(), 'dark', true);

    expect(result).toEqual([]);
    expect(mockRenderCharts).not.toHaveBeenCalled();
    expect(countUploadCalls()).toBe(0);
  });

  it('still renders and uploads when the flag is off (default)', async () => {
    const result = await buildChartAttachments(makeAppState(), makeQueryResultsMap(), 'dark', false);

    expect(result).toHaveLength(1);
    expect(mockRenderCharts).toHaveBeenCalledTimes(1);
    expect(countUploadCalls()).toBe(1);
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

    const urlsA = ['https://s3.example.com/a.jpg', 'https://s3.example.com/b.jpg'];
    global.fetch = makeFetchMock((i) => urlsA[i] ?? MOCK_PUBLIC_URL);

    mockRenderCharts
      .mockResolvedValueOnce([{ label: 'Chart A', dataUrl: 'data:image/jpeg;base64,aaa' }])
      .mockResolvedValueOnce([{ label: 'Chart B', dataUrl: 'data:image/jpeg;base64,bbb' }]);

    const attachments = await buildChartAttachments(dashboardAppState, qrMap, 'dark');

    expect(mockRenderCharts).toHaveBeenCalledTimes(2); // Chart A + B; table skipped
    expect(countUploadCalls()).toBe(2);
    expect(attachments).toHaveLength(2);
    expect(attachments.map(a => a.content)).toEqual([
      'https://s3.example.com/a.jpg',
      'https://s3.example.com/b.jpg',
    ]);
    expect(attachments.every(a => a.metadata?.auto === true)).toBe(true);
  });
});
