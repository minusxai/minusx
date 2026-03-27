import 'server-only';
import type { BusEventName, BusEventPayloads } from './events';

type Handler<T extends BusEventName> = (payload: BusEventPayloads[T]) => Promise<void> | void;

class EventBus {
  private handlers = new Map<BusEventName, Handler<BusEventName>[]>();

  sub<T extends BusEventName>(event: T, handler: Handler<T>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<BusEventName>);
    this.handlers.set(event, list);
  }

  pub<T extends BusEventName>(event: T, payload: BusEventPayloads[T]): void {
    const list = this.handlers.get(event) ?? [];
    if (!list.length) return;
    // Fire-and-forget: one failing handler never affects others or the caller
    Promise.allSettled(
      list.map(h => { try { return h(payload) ?? Promise.resolve(); } catch (e) { return Promise.reject(e); } })
    ).then(results => {
      results.forEach(r => { if (r.status === 'rejected') console.error('[event-bus] Handler failed:', r.reason); });
    });
  }
}

export const eventBus = new EventBus();
