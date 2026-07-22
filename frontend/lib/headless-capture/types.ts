/**
 * Headless story capture — contract types (Story_Design_V2 §6c).
 *
 * `renderStoryToImage` (lib/headless-capture/index.server.ts) is the seam: callers hand it a
 * story file id + base URL and get a bitmap back, never knowing (or caring) which backend
 * produced it. The production backend is Playwright-in-the-same-container
 * (playwright-backend.server.ts); tests exercise the lifecycle with a fake backend.
 *
 * This module is browser-free and server-only-free so the CaptureManager lifecycle can be
 * unit-tested without pulling in Playwright or Next server plumbing.
 */

export interface StoryCaptureInput {
  /** Integer file id of the story to capture (loaded via the app's /f/[id] route). */
  fileId: number;
  /** Origin of the running app, e.g. `http://localhost:3000`. */
  baseUrl: string;
  /** Capture width in CSS px (default 800). */
  width?: number;
  /** Output encoding (default 'jpeg'). */
  format?: 'jpeg' | 'png';
  /**
   * When set, the backend authenticates the page load as this user by minting a short-lived
   * NextAuth session cookie (session-cookie.server.ts). Required for non-public stories:
   * /f/[id] redirects unauthenticated requests to /login.
   */
  userEmail?: string;
}

export type StoryCaptureResult =
  | { ok: true; buffer: Buffer; mime: string }
  /**
   * 'unavailable' — the capability is off (env flag unset) or the browser cannot launch.
   * Callers degrade gracefully: no image attached, exactly the pre-§6c behavior.
   * 'error' — the capability is on but this capture failed (bad page, timeout, …).
   */
  | { ok: false; reason: 'unavailable' | 'error'; detail?: string };

/**
 * A launched capture backend. Created lazily by the CaptureManager on the first capture,
 * closed again after the idle window. `capture` may throw — the manager maps throws to
 * `{ ok: false, reason: 'error' }`.
 */
export interface StoryCaptureBackend {
  capture(input: StoryCaptureInput): Promise<{ buffer: Buffer; mime: string }>;
  close(): Promise<void>;
}

export interface CaptureManagerOptions {
  /** Re-read on every render call — a runtime flag flip applies immediately. */
  isEnabled: () => boolean;
  /** Launch the backend (e.g. a headless browser). A throw ⇒ 'unavailable'. */
  createBackend: () => Promise<StoryCaptureBackend>;
  /** Max concurrent captures (default 2). */
  concurrency?: number;
  /** Idle window after the last capture before the backend is shut down (default 60s). */
  idleMs?: number;
}
