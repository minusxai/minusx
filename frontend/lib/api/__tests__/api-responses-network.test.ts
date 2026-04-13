/**
 * Integration tests for api-responses → network-logging → fetch.
 *
 * Does NOT mock logNetworkResponse — tests the full chain from
 * successResponse/errorResponse/handleApiError down to the actual fetch call
 * that mx-llm-provider would receive, AND verifies the JSON response returned
 * to the client (including request_id).
 *
 * Only mocks: next/headers (request context), fetch (network boundary).
 */

jest.mock('next/headers', () => ({ headers: jest.fn() }));
jest.mock('@/lib/messaging/internal-notifier', () => ({
  notifyInternal: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/config', () => ({
  MX_API_BASE_URL: 'http://mx-api.test',
  MX_API_KEY: 'test-key',
  MX_NETWORK_LOG_EXCLUDE: '',
}));

import { headers as mockHeadersFn } from 'next/headers';
import { successResponse, errorResponse, handleApiError } from '../api-responses';
import { ErrorCodes } from '../api-types';

const mockHeaders = mockHeadersFn as jest.MockedFunction<typeof mockHeadersFn>;
const mockFetch = jest.fn().mockResolvedValue({ ok: true });
global.fetch = mockFetch;

type ReadonlyHeaders = Awaited<ReturnType<typeof import('next/headers')['headers']>>;

function makeHeaders(values: {
  requestId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  mode?: string | null;
  requestPath?: string | null;
}): ReadonlyHeaders {
  return {
    get: (key: string) => {
      switch (key) {
        case 'x-request-id':   return values.requestId ?? null;
        case 'x-company-id':   return values.companyId ?? null;
        case 'x-user-id':   return values.userId ?? null;
        case 'x-mode':         return values.mode ?? null;
        case 'x-request-path': return values.requestPath ?? null;
        default:               return null;
      }
    },
  } as unknown as ReadonlyHeaders;
}

beforeEach(() => {
  mockFetch.mockClear();
});

describe('successResponse', () => {
  it('includes request_id in response JSON and POSTs correct payload to /network/response', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({
      requestId: 'req-e2e-1',
      companyId: 'co-1',
      userId: 'alice@example.com',
      mode: 'org',
      requestPath: '/api/files',
    }));

    const res = await successResponse({ id: 42 });
    const clientBody = await res.json();

    // Client receives correct shape with request_id
    expect(clientBody.success).toBe(true);
    expect(clientBody.data).toEqual({ id: 42 });
    expect(clientBody.request_id).toBe('req-e2e-1');

    // Wait for fire-and-forget
    await new Promise(resolve => setTimeout(resolve, 0));

    // mx-llm-provider receives correct payload
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://mx-api.test/network/response');
    const networkBody = JSON.parse(options.body);
    expect(networkBody.request_id).toBe('req-e2e-1');
    expect(networkBody.status_code).toBe(200);
    expect(networkBody.is_error).toBe(false);
    expect(networkBody.response_body).toEqual({ success: true, data: { id: 42 } });
    expect(networkBody.company_id).toBe('co-1');
    expect(networkBody.user_id).toBe('alice@example.com');
    expect(networkBody.mode).toBe('org');
    expect(networkBody.path).toBe('/api/files');
  });

  it('omits request_id from response and does not call fetch when x-request-id absent', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({ requestId: null }));

    const res = await successResponse({ ok: true });
    const clientBody = await res.json();

    expect(clientBody.success).toBe(true);
    expect(clientBody.request_id).toBeUndefined();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still returns data when headers() throws', async () => {
    mockHeaders.mockRejectedValue(new Error('no request context'));

    const res = await successResponse({ value: 'hello' });
    const clientBody = await res.json();

    expect(clientBody.success).toBe(true);
    expect(clientBody.data).toEqual({ value: 'hello' });
  });
});

describe('errorResponse', () => {
  it('includes request_id in response JSON and POSTs is_error=true to /network/response', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({
      requestId: 'req-e2e-2',
      companyId: 'co-2',
      userId: 'bob@example.com',
      mode: 'tutorial',
      requestPath: '/api/query',
    }));

    const res = await errorResponse(ErrorCodes.NOT_FOUND, 'File not found', 404);
    const clientBody = await res.json();

    expect(clientBody.success).toBe(false);
    expect(clientBody.error.code).toBe('NOT_FOUND');
    expect(clientBody.request_id).toBe('req-e2e-2');

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const networkBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(networkBody.request_id).toBe('req-e2e-2');
    expect(networkBody.status_code).toBe(404);
    expect(networkBody.is_error).toBe(true);
    expect(networkBody.response_body.error.code).toBe('NOT_FOUND');
    expect(networkBody.company_id).toBe('co-2');
    expect(networkBody.user_id).toBe('bob@example.com');
    expect(networkBody.mode).toBe('tutorial');
  });

  it('omits request_id when header absent', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({ requestId: null }));

    const res = await errorResponse(ErrorCodes.FORBIDDEN, 'Forbidden', 403);
    const clientBody = await res.json();

    expect(clientBody.success).toBe(false);
    expect(clientBody.request_id).toBeUndefined();
  });
});

describe('handleApiError', () => {
  it('includes request_id in response JSON and POSTs to /network/response', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({
      requestId: 'req-e2e-3',
      companyId: 'co-3',
      userId: 'carol@example.com',
      mode: 'org',
    }));

    const res = await handleApiError(new Error('something broke'));
    const clientBody = await res.json();

    expect(clientBody.success).toBe(false);
    expect(clientBody.request_id).toBe('req-e2e-3');

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const networkBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(networkBody.request_id).toBe('req-e2e-3');
    expect(networkBody.is_error).toBe(true);
    expect(networkBody.status_code).toBe(500);
    expect(networkBody.company_id).toBe('co-3');
    expect(networkBody.user_id).toBe('carol@example.com');
  });

  it('still returns valid error response when headers() throws', async () => {
    mockHeaders.mockRejectedValue(new Error('no context'));

    const res = await handleApiError(new Error('oops'));
    const clientBody = await res.json();

    expect(clientBody.success).toBe(false);
    expect(clientBody.error).toBeDefined();
  });
});
