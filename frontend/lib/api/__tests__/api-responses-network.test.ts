/**
 * Integration tests for api-responses → network-logging → fetch.
 *
 * successResponse: pure builder — no network logging, only verifies JSON shape + request_id.
 * errorResponse / handleApiError: log to /network/response — tests verify the full chain
 * down to the fetch call that mx-llm-provider would receive.
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
        case 'x-user-id':      return values.userId ?? null;
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

// ── successResponse — pure builder, no network logging ────────────────────────

describe('successResponse', () => {
  it('includes request_id in response JSON', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({ requestId: 'req-1' }));

    const res = await successResponse({ id: 42 });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 42 });
    expect(body.request_id).toBe('req-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('omits request_id when header absent', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({ requestId: null }));

    const res = await successResponse({ ok: true });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.request_id).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still returns data when headers() throws', async () => {
    mockHeaders.mockRejectedValue(new Error('no request context'));

    const res = await successResponse({ value: 'hello' });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ value: 'hello' });
  });
});

// ── errorResponse — POSTs to /network/response ────────────────────────────────

describe('errorResponse', () => {
  it('includes request_id in response JSON and POSTs is_error=true to /network/response', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({
      requestId: 'req-e2e-2',
      companyId: 'co-2',
      userId: '99',
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
    expect(networkBody.user_id).toBe('99');
    expect(networkBody.mode).toBe('tutorial');
  });

  it('omits request_id when header absent and does not call fetch', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({ requestId: null }));

    const res = await errorResponse(ErrorCodes.FORBIDDEN, 'Forbidden', 403);
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.request_id).toBeUndefined();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── handleApiError — POSTs to /network/response ───────────────────────────────

describe('handleApiError', () => {
  it('includes request_id in response JSON and POSTs to /network/response', async () => {
    mockHeaders.mockResolvedValue(makeHeaders({
      requestId: 'req-e2e-3',
      companyId: 'co-3',
      userId: '42',
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
    expect(networkBody.user_id).toBe('42');
  });

  it('still returns valid error response when headers() throws', async () => {
    mockHeaders.mockRejectedValue(new Error('no context'));

    const res = await handleApiError(new Error('oops'));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });
});
