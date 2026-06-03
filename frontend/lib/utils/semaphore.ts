/**
 * A counting semaphore that bounds concurrent async work.
 *
 * The limit may be a fixed number or a getter (re-read on each acquire), so a
 * runtime-configurable value (e.g. hydrated from server config into Redux) can
 * change the cap without recreating the semaphore.
 *
 * @example
 *   const sem = new Semaphore(10);
 *   await sem.run(() => fetch('/api/query', ...));
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly getLimit: () => number;

  constructor(limit: number | (() => number)) {
    this.getLimit = typeof limit === 'function' ? limit : () => limit;
  }

  private get limit(): number {
    return Math.max(1, Math.floor(this.getLimit()));
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    // Hand the slot straight to the next waiter (active count unchanged);
    // only decrement when nobody is waiting.
    if (next) next();
    else this.active -= 1;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
