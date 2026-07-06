// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { IS_DEV, SEND_ERRORS_IN_DEV } from "@/lib/constants";
import { parseTelemetryLevel, sentryLevelOptions, shouldInitSentry } from "@/lib/telemetry";

// Skip Sentry init in dev (unless explicitly opted in via NEXT_PUBLIC_SEND_ERRORS_IN_DEV=true).
// Matches the client/server configs so dev runs aren't instrumented at all.
// MX_TELEMETRY governs what is sent (off / errors / full); the edge runtime
// exposes env vars on process.env, read directly like instrumentation.ts.
// eslint-disable-next-line no-restricted-syntax
const level = parseTelemetryLevel(process.env.MX_TELEMETRY);
if (level !== 'off' && shouldInitSentry({ isDev: IS_DEV, sendErrorsInDev: SEND_ERRORS_IN_DEV, level })) {
  Sentry.init({
    dsn: "https://4b0f002a96f1fe28a5a32b705ec67b92@o4511451869544448.ingest.us.sentry.io/4511451905785856",
    ...sentryLevelOptions(level),
  });
}
