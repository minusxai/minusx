/**
 * Best-effort in-memory rate limiter for anonymous guest chat turns.
 *
 * An open public-share link is otherwise an uncapped proxy to the LLM budget. This caps
 * turns per guest (keyed by the synthetic uid) per minute and per day. It is process-local
 * (resets on restart, not shared across instances) — adequate for the single-instance demo
 * deploys this feature targets; swap for a shared store (Redis) if shares ever run multi-instance.
 */
import 'server-only';

const PER_MINUTE = 6;
const PER_DAY = 100;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Bucket {
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dayCount: number;
}

// Intentional process-local cache: keyed by the per-guest synthetic uid (per-request scope),
// holding mutable rate-limit counters that must persist across requests within a process.
// eslint-disable-next-line no-restricted-syntax
const buckets = new Map<number, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry (set when blocked). */
  retryAfter?: number;
  reason?: string;
}

/** Record + check one guest chat turn. Returns whether it is allowed. */
export function checkGuestChatRateLimit(uid: number): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(uid);
  if (!b) {
    b = { minuteStart: now, minuteCount: 0, dayStart: now, dayCount: 0 };
    buckets.set(uid, b);
  }
  if (now - b.minuteStart >= MINUTE_MS) {
    b.minuteStart = now;
    b.minuteCount = 0;
  }
  if (now - b.dayStart >= DAY_MS) {
    b.dayStart = now;
    b.dayCount = 0;
  }
  if (b.dayCount >= PER_DAY) {
    return { allowed: false, retryAfter: Math.ceil((b.dayStart + DAY_MS - now) / 1000), reason: 'Daily limit reached for this shared link.' };
  }
  if (b.minuteCount >= PER_MINUTE) {
    return { allowed: false, retryAfter: Math.ceil((b.minuteStart + MINUTE_MS - now) / 1000), reason: 'Too many questions — please wait a moment.' };
  }
  b.minuteCount += 1;
  b.dayCount += 1;
  return { allowed: true };
}

/** Test helper: clear all buckets. */
export function __resetGuestRateLimits(): void {
  buckets.clear();
}
