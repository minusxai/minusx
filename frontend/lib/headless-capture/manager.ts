/**
 * CaptureManager — the backend-agnostic lifecycle for headless story capture (Story_Design_V2 §6c):
 * lazy singleton backend (launched on the first capture, zero cost if unused), a concurrency
 * semaphore bounding simultaneous captures, an idle-shutdown timer that closes the backend after
 * a quiet window, and graceful degradation (disabled/unlaunchable ⇒ `unavailable`, a failed
 * capture ⇒ `error` — never a throw).
 */
import { Semaphore } from '@/lib/utils/semaphore';
import type {
  CaptureManagerOptions,
  StoryCaptureBackend,
  StoryCaptureInput,
  StoryCaptureResult,
} from './types';

export const DEFAULT_CAPTURE_CONCURRENCY = 2;
export const DEFAULT_IDLE_SHUTDOWN_MS = 60_000;

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class CaptureManager {
  private readonly opts: CaptureManagerOptions;
  private readonly semaphore: Semaphore;
  private readonly idleMs: number;
  private backendPromise: Promise<StoryCaptureBackend> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = 0;

  constructor(opts: CaptureManagerOptions) {
    this.opts = opts;
    this.semaphore = new Semaphore(opts.concurrency ?? DEFAULT_CAPTURE_CONCURRENCY);
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_SHUTDOWN_MS;
  }

  async render(input: StoryCaptureInput): Promise<StoryCaptureResult> {
    if (!this.opts.isEnabled()) {
      return { ok: false, reason: 'unavailable', detail: 'headless capture is disabled' };
    }
    return this.semaphore.run(async () => {
      this.clearIdleTimer();
      this.inFlight += 1;
      try {
        let backend: StoryCaptureBackend;
        try {
          backend = await this.acquireBackend();
        } catch (err) {
          // The browser could not launch (not installed / sandbox failure). Treat as a
          // missing capability, not an error — callers degrade to no-image behavior.
          return { ok: false, reason: 'unavailable' as const, detail: detail(err) };
        }
        try {
          const { buffer, mime } = await backend.capture(input);
          return { ok: true as const, buffer, mime };
        } catch (err) {
          return { ok: false, reason: 'error' as const, detail: detail(err) };
        }
      } finally {
        this.inFlight -= 1;
        if (this.inFlight === 0) this.scheduleIdleShutdown();
      }
    });
  }

  /** Close the backend (if launched) and cancel any pending idle shutdown. */
  async shutdown(): Promise<void> {
    this.clearIdleTimer();
    const pending = this.backendPromise;
    this.backendPromise = null;
    if (!pending) return;
    try {
      await (await pending).close();
    } catch {
      // A backend that fails to close is already unusable — nothing to do.
    }
  }

  /** Lazy singleton: one launch shared by all captures; a failed launch clears the slot so a later render retries. */
  private acquireBackend(): Promise<StoryCaptureBackend> {
    if (!this.backendPromise) {
      const promise = this.opts.createBackend();
      this.backendPromise = promise;
      promise.catch(() => {
        if (this.backendPromise === promise) this.backendPromise = null;
      });
    }
    return this.backendPromise;
  }

  private scheduleIdleShutdown(): void {
    if (!this.backendPromise) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.shutdown();
    }, this.idleMs);
    // Never hold the process open just for the idle timer.
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
