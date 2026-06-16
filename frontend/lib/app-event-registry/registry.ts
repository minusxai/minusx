import type { AppEventName, AppEventPayloads } from './events';

type Handler<T extends AppEventName> = (payload: AppEventPayloads[T]) => Promise<void> | void;
type GlobalHandler = (event: AppEventName, payload: AppEventPayloads[AppEventName]) => Promise<void> | void;

export class AppEventRegistry {
  private handlers = new Map<AppEventName, Handler<AppEventName>[]>();
  private globalHandlers: GlobalHandler[] = [];

  subscribe<T extends AppEventName>(event: T, handler: Handler<T>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<AppEventName>);
    this.handlers.set(event, list);
  }

  /**
   * Subscribe to EVERY published event (receives the event name + payload).
   * Used by cross-cutting sinks: the local app_events store and the webhook forwarder.
   */
  subscribeAll(handler: GlobalHandler): void {
    this.globalHandlers.push(handler);
  }

  publish<T extends AppEventName>(event: T, payload: AppEventPayloads[T]): void {
    const specific = this.handlers.get(event) ?? [];
    if (!specific.length && !this.globalHandlers.length) return;
    const run = (fn: () => Promise<void> | void) => {
      try { return fn() ?? Promise.resolve(); } catch (e) { return Promise.reject(e); }
    };
    Promise.allSettled([
      ...specific.map(h => run(() => h(payload))),
      ...this.globalHandlers.map(g => run(() => g(event, payload as AppEventPayloads[AppEventName]))),
    ]).then(results => {
      results.forEach(r => { if (r.status === 'rejected') console.error('[app-event-registry] Handler failed:', r.reason); });
    });
  }
}

export const appEventRegistry = new AppEventRegistry();
