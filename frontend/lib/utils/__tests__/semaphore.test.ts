/**
 * Semaphore — bounds how many async tasks run concurrently.
 *
 * Used to cap in-flight /api/query calls from the browser so a dashboard's
 * parallel card queries don't overwhelm the single Node server.
 */

import { Semaphore } from '@/lib/utils/semaphore';

// Resolves on the next macrotask so overlapping run() calls actually coexist.
const tick = () => new Promise<void>((r) => setTimeout(r, 1));

describe('Semaphore', () => {
  it('never runs more than `limit` tasks concurrently', async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;

    const task = () =>
      sem.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick();
        active -= 1;
      });

    await Promise.all(Array.from({ length: 12 }, task));

    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('runs every task and preserves return values', async () => {
    const sem = new Semaphore(2);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => sem.run(async () => { await tick(); return i * 2; })),
    );
    expect(results).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('releases the slot even when a task throws', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // If the slot leaked, this second task would hang forever.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('reads the limit dynamically when given a function', async () => {
    let limit = 2;
    const sem = new Semaphore(() => limit);
    let active = 0;
    let peak = 0;
    const task = () => sem.run(async () => { active += 1; peak = Math.max(peak, active); await tick(); active -= 1; });

    await Promise.all(Array.from({ length: 6 }, task));
    expect(peak).toBe(2);

    limit = 4;
    peak = 0;
    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBe(4);
  });
});
