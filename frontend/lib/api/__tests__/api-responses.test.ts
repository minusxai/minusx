/**
 * Tests for api-responses helpers.
 * Verifies that successResponse / errorResponse / handleApiError include
 * request_id (read from x-request-id header via next/headers) in JSON bodies.
 */

// Must be first — mocks run before imports
jest.mock('next/headers', () => ({
  headers: jest.fn(),
}));

jest.mock('@/lib/messaging/internal-notifier', () => ({
  notifyInternal: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/network-logging', () => ({
  logNetworkResponse: jest.fn().mockResolvedValue(undefined),
}));

import { headers as mockHeadersFn } from 'next/headers';
import { successResponse, errorResponse, handleApiError } from '../api-responses';
import { ErrorCodes } from '../api-types';

const mockHeaders = mockHeadersFn as jest.MockedFunction<typeof mockHeadersFn>;

function makeHeadersMap(requestId: string | null): ReadonlyHeaders {
  return {
    get: (key: string) => (key === 'x-request-id' ? requestId : null),
  } as unknown as ReadonlyHeaders;
}

// ReadonlyHeaders type alias (not imported to avoid complexity)
type ReadonlyHeaders = Awaited<ReturnType<typeof import('next/headers')['headers']>>;

describe('successResponse', () => {
  it('includes request_id from x-request-id header', async () => {
    mockHeaders.mockResolvedValue(makeHeadersMap('req-success-1'));

    const res = await successResponse({ id: 42 });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 42 });
    expect(body.request_id).toBe('req-success-1');
  });

  it('omits request_id when x-request-id header is absent', async () => {
    mockHeaders.mockResolvedValue(makeHeadersMap(null));

    const res = await successResponse({ ok: true });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.request_id).toBeUndefined();
  });

  it('still returns data correctly when headers() throws (no request context)', async () => {
    mockHeaders.mockRejectedValue(new Error('no request context'));

    const res = await successResponse({ value: 'hello' });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ value: 'hello' });
  });
});

describe('errorResponse', () => {
  it('includes request_id from x-request-id header', async () => {
    mockHeaders.mockResolvedValue(makeHeadersMap('req-error-1'));

    const res = await errorResponse(ErrorCodes.NOT_FOUND, 'File not found', 404);
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.request_id).toBe('req-error-1');
  });

  it('omits request_id when header absent', async () => {
    mockHeaders.mockResolvedValue(makeHeadersMap(null));

    const res = await errorResponse(ErrorCodes.FORBIDDEN, 'Forbidden', 403);
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.request_id).toBeUndefined();
  });
});

describe('handleApiError', () => {
  it('includes request_id in the response for generic errors', async () => {
    mockHeaders.mockResolvedValue(makeHeadersMap('req-handle-err-1'));

    const res = await handleApiError(new Error('something broke'));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.request_id).toBe('req-handle-err-1');
  });

  it('still returns valid error response when headers() throws', async () => {
    mockHeaders.mockRejectedValue(new Error('no context'));

    const res = await handleApiError(new Error('oops'));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });
});
