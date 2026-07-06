// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { IS_DEV, SEND_ERRORS_IN_DEV } from "@/lib/constants";
import { parseTelemetryLevel, sentryLevelOptions, shouldInitSentry } from "@/lib/telemetry";

// Skip Sentry init in dev (unless explicitly opted in via NEXT_PUBLIC_SEND_ERRORS_IN_DEV=true).
// Matches the client config so dev runs aren't instrumented at all.
// MX_TELEMETRY governs what is sent: off = nothing, errors (default) = crash
// reports only (no traces/logs/PII), full = traces + logs + PII. Read directly
// because this file runs at instrumentation time, outside the app module
// graph — same pattern as instrumentation.ts.
// eslint-disable-next-line no-restricted-syntax
const level = parseTelemetryLevel(process.env.MX_TELEMETRY);
if (level !== 'off' && shouldInitSentry({ isDev: IS_DEV, sendErrorsInDev: SEND_ERRORS_IN_DEV, level })) {
  Sentry.init({
    dsn: "https://4b0f002a96f1fe28a5a32b705ec67b92@o4511451869544448.ingest.us.sentry.io/4511451905785856",
    ...sentryLevelOptions(level),
  });
}
