import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { AppEventPayloads } from './events';

/**
 * Mirror an `AppEvents.ERROR` event to Sentry. This is the single bridge between
 * the app's error pipeline (client `captureError` → `/api/capture-error`, and
 * server `handleApiError`, which both publish `AppEvents.ERROR`) and Sentry.
 *
 * Without it, every error reported through that pipeline reaches Slack (via
 * `notifyAppEvent`) but never Sentry — only code paths that explicitly call
 * `Sentry.captureException` (e.g. `global-error.tsx`) show up there.
 *
 * Client reports arrive as a `message` + a serialized `stack` string (the
 * original Error doesn't cross the network), so reconstruct an Error for Sentry
 * to group on; pass a real Error straight through when one is present.
 */
export function reportErrorToSentry(p: AppEventPayloads['error']): void {
  let err: Error;
  if (p.error instanceof Error) {
    err = p.error;
  } else {
    err = new Error(p.message);
    const stack = p.context?.stack;
    if (typeof stack === 'string') err.stack = stack;
  }

  Sentry.captureException(err, {
    tags: { source: p.source, mode: p.mode ?? 'org' },
    extra: { ...p.context },
  });
}
