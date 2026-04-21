import type { AppEventName, AppEventPayloads } from './events';

type Handler<T extends AppEventName> = (payload: AppEventPayloads[T]) => Promise<void> | void;

export class AppEventRegistry {
  private handlers = new Map<AppEventName, Handler<AppEventName>[]>();

  subscribe<T extends AppEventName>(event: T, handler: Handler<T>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<AppEventName>);
    this.handlers.set(event, list);
  }

  publish<T extends AppEventName>(event: T, payload: AppEventPayloads[T]): void {
    const list = this.handlers.get(event) ?? [];
    if (!list.length) return;
    Promise.allSettled(
      list.map(h => { try { return h(payload) ?? Promise.resolve(); } catch (e) { return Promise.reject(e); } })
    ).then(results => {
      results.forEach(r => { if (r.status === 'rejected') console.error('[app-event-registry] Handler failed:', r.reason); });
    });
  }
}

export const appEventRegistry = new AppEventRegistry();
