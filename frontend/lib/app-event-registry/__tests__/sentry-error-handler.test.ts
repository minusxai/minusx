import { vi, describe, it, expect, beforeEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }));

// Imported after the mock is registered.
import { reportErrorToSentry } from '../sentry-error-handler';
import type { AppEventPayloads } from '../events';

describe('reportErrorToSentry', () => {
  beforeEach(() => captureException.mockClear());

  it('mirrors a client capture-error report (message + stack string) to Sentry', () => {
    const payload: AppEventPayloads['error'] = {
      source: 'frontend:file-page-error',
      message: 'f.map is not a function',
      mode: 'org',
      context: { stack: 'TypeError: f.map is not a function\n    at Y (...)', url: 'https://x/f/2158', user: 'a@b.com' },
    };
    reportErrorToSentry(payload);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, opts] = captureException.mock.calls[0] as [Error, { tags?: Record<string, unknown>; extra?: Record<string, unknown> }];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('f.map is not a function');
    expect(err.stack).toContain('f.map is not a function');
    expect(opts.tags).toMatchObject({ source: 'frontend:file-page-error', mode: 'org' });
    expect(opts.extra).toMatchObject({ url: 'https://x/f/2158', user: 'a@b.com' });
  });

  it('passes through a real Error instance when one is provided', () => {
    const real = new Error('boom');
    const payload = { source: 'api:query', message: 'boom', error: real } as AppEventPayloads['error'];
    reportErrorToSentry(payload);

    const [err] = captureException.mock.calls[0] as [Error];
    expect(err).toBe(real);
  });
});
