/**
 * CaptureManager contract tests (Story_Design_V2 §6c) — driven entirely through a FAKE backend:
 * env gating, lazy singleton launch, concurrency semaphore, idle shutdown, and error mapping.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CaptureManager } from '@/lib/headless-capture/manager';
import type { StoryCaptureBackend, StoryCaptureInput } from '@/lib/headless-capture/types';

const INPUT: StoryCaptureInput = { fileId: 1, baseUrl: 'http://localhost:3000' };

interface FakeBackendControls {
  backend: StoryCaptureBackend;
  captureCalls: StoryCaptureInput[];
  closeCalls: number;
}

function makeFakeBackend(
  capture?: (input: StoryCaptureInput) => Promise<{ buffer: Buffer; mime: string }>,
): FakeBackendControls {
  const controls: FakeBackendControls = {
    captureCalls: [],
    closeCalls: 0,
    backend: {
      async capture(input) {
        controls.captureCalls.push(input);
        if (capture) return capture(input);
        return { buffer: Buffer.from('img'), mime: 'image/jpeg' };
      },
      async close() {
        controls.closeCalls += 1;
      },
    },
  };
  return controls;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CaptureManager', () => {
  it('returns { ok: false, reason: "unavailable" } when disabled, without ever launching a backend', async () => {
    const createBackend = vi.fn();
    const manager = new CaptureManager({ isEnabled: () => false, createBackend });

    const result = await manager.render(INPUT);

    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(createBackend).not.toHaveBeenCalled();
  });

  it('returns the backend capture on success', async () => {
    const fake = makeFakeBackend(async () => ({ buffer: Buffer.from('pixels'), mime: 'image/png' }));
    const manager = new CaptureManager({ isEnabled: () => true, createBackend: async () => fake.backend });

    const result = await manager.render({ ...INPUT, format: 'png' });

    expect(result).toEqual({ ok: true, buffer: Buffer.from('pixels'), mime: 'image/png' });
    expect(fake.captureCalls).toHaveLength(1);
    expect(fake.captureCalls[0]).toMatchObject({ fileId: 1, format: 'png' });
  });

  it('launches the backend lazily and exactly once across sequential captures', async () => {
    const fake = makeFakeBackend();
    const createBackend = vi.fn(async () => fake.backend);
    const manager = new CaptureManager({ isEnabled: () => true, createBackend });

    expect(createBackend).not.toHaveBeenCalled(); // zero cost if unused
    await manager.render(INPUT);
    await manager.render(INPUT);

    expect(createBackend).toHaveBeenCalledTimes(1);
    expect(fake.captureCalls).toHaveLength(2);
    await manager.shutdown();
  });

  it('maps a backend-launch failure to "unavailable" and retries the launch on a later render', async () => {
    const fake = makeFakeBackend();
    const createBackend = vi
      .fn<() => Promise<StoryCaptureBackend>>()
      .mockRejectedValueOnce(new Error('chromium not installed'))
      .mockResolvedValue(fake.backend);
    const manager = new CaptureManager({ isEnabled: () => true, createBackend });

    const first = await manager.render(INPUT);
    expect(first).toMatchObject({ ok: false, reason: 'unavailable', detail: 'chromium not installed' });

    const second = await manager.render(INPUT);
    expect(second).toMatchObject({ ok: true });
    expect(createBackend).toHaveBeenCalledTimes(2);
    await manager.shutdown();
  });

  it('maps a capture throw to { ok: false, reason: "error" } and keeps the backend usable', async () => {
    let shouldThrow = true;
    const fake = makeFakeBackend(async () => {
      if (shouldThrow) throw new Error('page timeout');
      return { buffer: Buffer.from('img'), mime: 'image/jpeg' };
    });
    const createBackend = vi.fn(async () => fake.backend);
    const manager = new CaptureManager({ isEnabled: () => true, createBackend });

    const failed = await manager.render(INPUT);
    expect(failed).toMatchObject({ ok: false, reason: 'error', detail: 'page timeout' });

    shouldThrow = false;
    const ok = await manager.render(INPUT);
    expect(ok).toMatchObject({ ok: true });
    expect(createBackend).toHaveBeenCalledTimes(1); // error did not tear down the singleton
    await manager.shutdown();
  });

  it('bounds concurrent captures with the semaphore (limit 2)', async () => {
    let active = 0;
    let maxActive = 0;
    const gates: Array<() => void> = [];
    const fake = makeFakeBackend(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active -= 1;
      return { buffer: Buffer.from('img'), mime: 'image/jpeg' };
    });
    const manager = new CaptureManager({
      isEnabled: () => true,
      createBackend: async () => fake.backend,
      concurrency: 2,
    });

    const renders = Promise.all([1, 2, 3, 4].map((fileId) => manager.render({ ...INPUT, fileId })));
    // Let the first wave start; only 2 may be in flight.
    await vi.waitFor(() => expect(gates.length).toBe(2));
    expect(active).toBe(2);

    // Release all four (later gates appear as earlier captures finish).
    let released = 0;
    while (released < 4) {
      const gate = gates.shift();
      if (gate) {
        gate();
        released += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const results = await renders;

    expect(maxActive).toBe(2);
    expect(results.every((r) => r.ok)).toBe(true);
    await manager.shutdown();
  });

  it('shuts the backend down after the idle window and relaunches on the next capture', async () => {
    vi.useFakeTimers();
    const fake = makeFakeBackend();
    const createBackend = vi.fn(async () => fake.backend);
    const manager = new CaptureManager({
      isEnabled: () => true,
      createBackend,
      idleMs: 60_000,
    });

    await manager.render(INPUT);
    expect(fake.closeCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(fake.closeCalls).toBe(0); // still inside the idle window

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fake.closeCalls).toBe(1); // idle shutdown fired

    await manager.render(INPUT); // relaunch after shutdown
    expect(createBackend).toHaveBeenCalledTimes(2);
    await manager.shutdown();
  });

  it('a capture inside the idle window resets the shutdown timer', async () => {
    vi.useFakeTimers();
    const fake = makeFakeBackend();
    const manager = new CaptureManager({
      isEnabled: () => true,
      createBackend: async () => fake.backend,
      idleMs: 60_000,
    });

    await manager.render(INPUT);
    await vi.advanceTimersByTimeAsync(30_000);
    await manager.render(INPUT); // resets the idle clock
    await vi.advanceTimersByTimeAsync(45_000);
    expect(fake.closeCalls).toBe(0); // 45s < 60s since the LAST capture

    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.closeCalls).toBe(1);
  });

  it('shutdown() closes a launched backend and is safe to call when never launched', async () => {
    const fake = makeFakeBackend();
    const manager = new CaptureManager({ isEnabled: () => true, createBackend: async () => fake.backend });

    await manager.shutdown(); // never launched — no-op
    expect(fake.closeCalls).toBe(0);

    await manager.render(INPUT);
    await manager.shutdown();
    expect(fake.closeCalls).toBe(1);
  });
});
