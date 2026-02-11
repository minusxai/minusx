/**
 * Centralized fetch mocking for E2E tests
 *
 * Handles routing /api/chat to Next.js handler while letting Python backend
 * calls through to the real server.
 */

import { NextRequest } from 'next/server';

/**
 * Common interceptors that can be reused across tests
 */
export const commonInterceptors = {
  /** Mock /api/query with simple test data */
  mockQuerySimple: async (urlStr: string) => {
    if (urlStr.includes('/api/query')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          columns: ['test'],
          rows: [{ test: 1 }]
        })
      } as Response;
    }
    return null;
  },

  /** Mock /api/query with sales data */
  mockQuerySales: async (urlStr: string) => {
    if (urlStr.includes('/api/query')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          columns: ['region', 'total_sales'],
          rows: [
            { region: 'Southwest', total_sales: 27150594.59 },
            { region: 'Canada', total_sales: 18398929.19 }
          ]
        })
      } as Response;
    }
    return null;
  },

  /** Mock /api/connections/[id]/schema with simple schema */
  mockSchemaSimple: async (urlStr: string) => {
    if (urlStr.includes('/api/connections/') && urlStr.includes('/schema')) {
      return {
        ok: true,
        status: 200,
        json: async () => ([{ schema: 'public', tables: ['test_table'] }])
      } as Response;
    }
    return null;
  },

  /** Mock /api/connections/[id]/schema with sales schema */
  mockSchemaSales: async (urlStr: string) => {
    if (urlStr.includes('/api/connections/') && urlStr.includes('/schema')) {
      return {
        ok: true,
        status: 200,
        json: async () => ([{ schema: 'public', tables: ['SalesTerritory', 'SalesOrderHeader'] }])
      } as Response;
    }
    return null;
  }
};

/**
 * Interceptor configuration for mocking Next.js API routes
 */
export interface RouteInterceptor {
  /** Match URLs that include any of these strings */
  includesUrl?: string[];
  /** Match URLs that start with any of these strings */
  startsWithUrl?: string[];
  /** The Next.js route handler to call */
  handler: (request: NextRequest) => Promise<Response>;
}

export interface MockFetchOptions {
  /** Function that returns the current Python backend port */
  getPythonPort: () => number;
  /** Route interceptors for Next.js API routes (e.g., /api/chat, /api/sql-to-ir) */
  interceptors?: RouteInterceptor[];
  /** Optional function that returns the LLM mock server port */
  getLLMMockPort?: () => number;
  /** Additional custom interceptors for test-specific APIs (legacy - prefer interceptors array) */
  additionalInterceptors?: Array<(urlStr: string, init?: any, originalFetch?: typeof fetch) => Promise<Response | null>>;
}

/**
 * Sets up a mock fetch implementation for E2E tests.
 *
 * Usage:
 * ```ts
 * const mockFetch = setupMockFetch({ getPythonPort, chatPostHandler });
 * ```
 */
export function setupMockFetch(options: MockFetchOptions) {
  const { getPythonPort, interceptors = [], getLLMMockPort, additionalInterceptors = [] } = options;
  const originalFetch = global.fetch;

  const mockFetch = jest.fn(async (url: string | Request | URL, init?: any) => {
    const urlStr = url.toString();

    // Try additional interceptors first (legacy pattern)
    for (const interceptor of additionalInterceptors) {
      const response = await interceptor(urlStr, init, originalFetch);
      if (response !== null) {
        return response;
      }
    }

    // Try route interceptors (new pattern)
    for (const interceptor of interceptors) {
      let matches = false;

      // Check includesUrl patterns
      if (interceptor.includesUrl) {
        matches = interceptor.includesUrl.some(pattern => urlStr.includes(pattern));
      }

      // Check startsWithUrl patterns
      if (!matches && interceptor.startsWithUrl) {
        matches = interceptor.startsWithUrl.some(pattern => urlStr.startsWith(pattern));
      }

      if (matches) {
        // Extract path from matching pattern for NextRequest construction
        // Use startsWithUrl first (e.g., "/api/chat") as it's already a clean path
        const pattern = interceptor.startsWithUrl?.[0] || interceptor.includesUrl?.[0] || '/unknown';

        // Clean the pattern to get just the path
        let cleanPath = pattern;
        if (pattern.includes('localhost:3000')) {
          // Extract path from full URL like "localhost:3000/api/chat"
          cleanPath = pattern.split('localhost:3000')[1] || pattern;
        }
        if (!cleanPath.startsWith('/')) {
          cleanPath = '/' + cleanPath;
        }

        const fullUrl = `http://localhost:3000${cleanPath}`;

        const request = new NextRequest(fullUrl, {
          method: init?.method || 'POST',
          body: init?.body,
          headers: init?.headers
        });

        const response = await interceptor.handler(request);
        const data = await response.json();

        return {
          ok: response.status === 200,
          status: response.status,
          json: async () => data
        } as Response;
      }
    }

    // Let Python backend calls through to real backend using original fetch
    // Support both dynamic port and default port (8001) for BACKEND_URL constant
    const pythonPort = getPythonPort();
    if (pythonPort && (urlStr.includes(`localhost:${pythonPort}`) || urlStr.includes('localhost:8001'))) {
      // Redirect calls to default port to dynamic port
      const redirectedUrl = urlStr.replace('localhost:8001', `localhost:${pythonPort}`);
      return originalFetch(redirectedUrl, init);
    }

    // Let LLM mock server calls through to real server
    const llmMockPort = getLLMMockPort?.();
    if (llmMockPort && urlStr.includes(`localhost:${llmMockPort}`)) {
      return originalFetch(urlStr, init);
    }

    // Mock health check to always return healthy
    if (urlStr.includes('/health')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' })
      } as Response;
    }

    throw new Error(`Unmocked fetch call to ${urlStr}`);
  });

  jest.spyOn(global, 'fetch').mockImplementation(mockFetch as any);

  afterEach(() => {
    // Clear mock call history to prevent memory accumulation
    mockFetch.mockClear();
    // Manually clear stored calls and results to free memory
    if (mockFetch.mock) {
      mockFetch.mock.calls = [];
      mockFetch.mock.results = [];
      mockFetch.mock.instances = [];
    }
  });

  afterAll(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    mockFetch.mockRestore();
  });

  return mockFetch;
}
