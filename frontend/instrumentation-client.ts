// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { IS_DEV, SEND_ERRORS_IN_DEV } from "@/lib/constants";
import { isClientTelemetryDisabled, shouldInitSentry } from "@/lib/telemetry";

// Skip Sentry init in dev (unless explicitly opted in via NEXT_PUBLIC_SEND_ERRORS_IN_DEV=true).
// The SDK wraps fetch/timers/console/Promise globally; a perf trace showed ~5k wrapped
// callbacks (≈780ms) in a 16s dev session. Initializing only in prod avoids that overhead.
// MX_DISABLE_TELEMETRY is a runtime server var — it can't be read here (NEXT_PUBLIC_*
// inlining is build-time), so the root layout stamps an opt-out attribute on <html>
// during SSR and we read it off the live document before initializing.
if (shouldInitSentry({
  isDev: IS_DEV,
  sendErrorsInDev: SEND_ERRORS_IN_DEV,
  telemetryDisabled: typeof document !== 'undefined'
    && isClientTelemetryDisabled(document.documentElement),
})) {
  Sentry.init({
    dsn: "https://4b0f002a96f1fe28a5a32b705ec67b92@o4511451869544448.ingest.us.sentry.io/4511451905785856",

    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: 1,
    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Enable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
