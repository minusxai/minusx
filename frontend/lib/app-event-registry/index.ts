import 'server-only';
import { AppEvents } from './events';
import type { AppEventName, AppEventPayloads } from './events';
import { trackFileEvent, trackLLMCallEvents, trackQueryExecutionEvent } from '@/lib/analytics/file-analytics.server';
import { notifyErrorEvent } from '@/lib/messaging/error-notifier';
import { notifyAppEvent } from '@/lib/messaging/app-events-notifier';

export { AppEvents } from './events';
export type { AppEventName, AppEventPayloads } from './events';

type Handler<T extends AppEventName> = (payload: AppEventPayloads[T]) => Promise<void> | void;

class AppEventRegistry {
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

// Register handlers — runs once when this module is first imported.
// To add a new handler (Slack, Sentry, etc.), add another subscribe() call here.
appEventRegistry.subscribe(AppEvents.FILE_CREATED,             p => trackFileEvent({ eventType: 'created',           ...p }));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED,              p => trackFileEvent({ eventType: 'read_direct',       ...p }));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED_AS_REFERENCE, p => trackFileEvent({ eventType: 'read_as_reference', ...p }));
appEventRegistry.subscribe(AppEvents.FILE_UPDATED,             p => trackFileEvent({ eventType: 'updated',           ...p }));
appEventRegistry.subscribe(AppEvents.FILE_DELETED,             p => trackFileEvent({ eventType: 'deleted',           ...p }));
appEventRegistry.subscribe(AppEvents.LLM_CALL,                 p => trackLLMCallEvents(p.llmCalls, p.conversationId, p.companyId, p.userId!, p.userEmail!, p.userRole!));
appEventRegistry.subscribe(AppEvents.QUERY_EXECUTED,           p => trackQueryExecutionEvent({ queryHash: p.queryHash, databaseName: p.databaseName, durationMs: p.durationMs, rowCount: p.rowCount, wasCacheHit: p.wasCacheHit, userEmail: p.userEmail ?? null, companyId: p.companyId }));
appEventRegistry.subscribe(AppEvents.ERROR,                    p => notifyErrorEvent(p));
appEventRegistry.subscribe(AppEvents.USER_MESSAGE,             p => notifyAppEvent('user:message', p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.USER_LOGGED_IN,           p => notifyAppEvent('user:login',   p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.USER_CREATED,             p => notifyAppEvent('user:created', p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.USER_DELETED,             p => notifyAppEvent('user:deleted', p as unknown as Record<string, unknown>));
