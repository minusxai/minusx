/**
 * Umbrella telemetry kill-switch (`MX_DISABLE_TELEMETRY`).
 *
 * One runtime env var disables everything that reports outside the deployment:
 * Sentry crash/trace reporting (server, edge, and client) and product
 * analytics. Defaults stay unchanged when unset (crash reporting on in prod,
 * analytics off unless configured).
 *
 * This module is intentionally universal (no `server-only`, no env reads):
 * it is imported by the Sentry init files (which run outside the normal app
 * module graph, including the edge runtime), by the root layout, and by
 * `instrumentation-client.ts` in the browser. The env var itself is read
 * server-side only; the browser learns the setting via an attribute the root
 * layout stamps on `<html>` — `NEXT_PUBLIC_*` inlining happens at build time,
 * so a runtime flag can never reach a prebuilt client bundle through env.
 */

/** Attribute stamped on `<html>` by the root layout when telemetry is disabled. */
export const TELEMETRY_OPT_OUT_ATTR = 'data-mx-telemetry';

/** Value of {@link TELEMETRY_OPT_OUT_ATTR} that marks telemetry as disabled. */
export const TELEMETRY_OPT_OUT_VALUE = 'off';

/** Parse the `MX_DISABLE_TELEMETRY` env value. Only explicit opt-outs count. */
export function parseTelemetryDisabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * Single gate shared by all three Sentry init files. Dev skips Sentry unless
 * explicitly opted in (SDK wrapping is expensive in dev — see the init files);
 * the telemetry kill-switch wins over everything.
 */
export function shouldInitSentry(opts: {
  isDev: boolean;
  sendErrorsInDev: boolean;
  telemetryDisabled: boolean;
}): boolean {
  if (opts.telemetryDisabled) return false;
  return !opts.isDev || opts.sendErrorsInDev;
}

/**
 * Browser-side check: reads the opt-out attribute off the `<html>` element
 * (`document.documentElement`). The root layout stamps it during SSR, so it is
 * present before any client script runs — unlike streamed meta tags.
 */
export function isClientTelemetryDisabled(
  root: { getAttribute(name: string): string | null } | null | undefined,
): boolean {
  return root?.getAttribute(TELEMETRY_OPT_OUT_ATTR) === TELEMETRY_OPT_OUT_VALUE;
}
