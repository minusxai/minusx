import type { MockInstance } from 'vitest';
/**
 * Centralized fetch mocking for E2E tests
 *
 * Routes API calls (e.g. /api/chat) to the in-process Next.js route handlers.
 */

import { NextRequest } from 'next/server';
import { encodeResultToJsonl } from '@/lib/query-cache/jsonl';

/**
 * Common interceptors that can be reused across tests
 */
export const commonInterceptors = {
  /** Mock /api/query with sales data. Returns the JSONL wire format the real route now emits. */
  mockQuerySales: async (urlStr: string) => {
    if (urlStr.includes('/api/query')) {
      const text = encodeResultToJsonl({
        columns: ['region', 'total_sales'],
        types: ['text', 'number'],
        rows: [
          { region: 'Southwest', total_sales: 27150594.59 },
          { region: 'Canada', total_sales: 18398929.19 },
        ],
        finalQuery: '',
      });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'X-Cache': 'miss', 'X-Cached-At': '0' }),
        text: async () => text,
        json: async () => JSON.parse(text.split('\n')[0]),
      } as unknown as Response;
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
  /** Route interceptors for Next.js API routes (e.g., /api/chat, /api/sql-to-ir) */
  interceptors?: RouteInterceptor[];
  /** Additional custom interceptors for test-specific APIs (legacy - prefer interceptors array) */
  additionalInterceptors?: Array<(urlStr: string, init?: any, originalFetch?: typeof fetch) => Promise<Response | null>>;
}

/**
 * Sets up a mock fetch implementation for E2E tests.
 *
 * Usage:
 * ```ts
 * const mockFetch = setupMockFetch({ interceptors: [{ startsWithUrl: ['/api/chat'], handler: chatPostHandler }] });
 * ```
 */
export function setupMockFetch(options: MockFetchOptions) {
  const { interceptors = [], additionalInterceptors = [] } = options;
  let originalFetch: typeof fetch;
  let spy: MockInstance;

  const mockFetch = vi.fn(async (url: string | Request | URL, init?: any) => {
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
        // Read the body once as text so both JSON routes and the JSONL /api/query
        // stream are supported; expose .text()/.json()/headers like a real Response.
        const text = await response.text();
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          headers: response.headers,
          text: async () => text,
          json: async () => JSON.parse(text),
        } as unknown as Response;
      }
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

  beforeAll(() => {
    originalFetch = global.fetch;
    spy = vi.spyOn(global, 'fetch').mockImplementation(mockFetch as any);
  });

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
    spy?.mockRestore();
  });

  return mockFetch;
}
