/**
 * Leveled telemetry control (`MX_TELEMETRY`).
 *
 * One runtime env var governs everything that reports outside the deployment:
 *
 *   - `off`    (`0`) — nothing leaves the box: no Sentry, no product analytics.
 *   - `errors` (`1`) — DEFAULT. Sentry crash/error reports only: no performance
 *                      traces, no logs, no PII. Product analytics stays off
 *                      unless explicitly configured at runtime (a config baked
 *                      into the image at build time does NOT count).
 *   - `full`   (`2`) — everything: traces, logs, PII, and image-baked
 *                      analytics defaults apply. Hosted deployments opt into
 *                      this explicitly.
 *
 * This module is intentionally universal (no `server-only`, no env reads):
 * it is imported by the Sentry init files (which run outside the normal app
 * module graph, including the edge runtime), by the root layout, and by
 * `instrumentation-client.ts` in the browser. The env var itself is read
 * server-side only; the browser learns the level via an attribute the root
 * layout stamps on `<html>` — `NEXT_PUBLIC_*` inlining happens at build time,
 * so a runtime flag can never reach a prebuilt client bundle through env.
 */

export type TelemetryLevel = 'off' | 'errors' | 'full';

/** Attribute stamped on `<html>` by the root layout carrying the level. */
export const TELEMETRY_LEVEL_ATTR = 'data-mx-telemetry';

const NUMERIC_ALIASES: Record<string, TelemetryLevel> = {
  '0': 'off',
  '1': 'errors',
  '2': 'full',
};

/**
 * Parse `MX_TELEMETRY`. Unset/unrecognized values fall back to `errors` — the
 * safe default is crash-reports-without-PII, never `full`.
 */
export function parseTelemetryLevel(value: string | undefined): TelemetryLevel {
  if (!value) return 'errors';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'errors' || normalized === 'full') return normalized;
  return NUMERIC_ALIASES[normalized] ?? 'errors';
}

/**
 * Single gate shared by all three Sentry init files. Dev skips Sentry unless
 * explicitly opted in (SDK wrapping is expensive in dev — see the init files);
 * level `off` wins over everything.
 */
export function shouldInitSentry(opts: {
  isDev: boolean;
  sendErrorsInDev: boolean;
  level: TelemetryLevel;
}): boolean {
  if (opts.level === 'off') return false;
  return !opts.isDev || opts.sendErrorsInDev;
}

/**
 * The level-dependent slice of Sentry init options, shared by all three
 * runtimes so `errors` means the same thing everywhere: crash reports only.
 */
export function sentryLevelOptions(level: Exclude<TelemetryLevel, 'off'>): {
  tracesSampleRate: number;
  enableLogs: boolean;
  sendDefaultPii: boolean;
} {
  if (level === 'errors') {
    return { tracesSampleRate: 0, enableLogs: false, sendDefaultPii: false };
  }
  return { tracesSampleRate: 1, enableLogs: true, sendDefaultPii: true };
}

/**
 * Browser-side level: read off the `<html>` element (`document.documentElement`),
 * where the root layout stamps it during SSR — present before any client script
 * runs, unlike streamed meta tags. Absent/unknown → `errors`, never `full`.
 */
export function clientTelemetryLevel(
  root: { getAttribute(name: string): string | null } | null | undefined,
): TelemetryLevel {
  const value = root?.getAttribute(TELEMETRY_LEVEL_ATTR);
  if (value === 'off' || value === 'errors' || value === 'full') return value;
  return 'errors';
}
