import 'server-only';
import { AppEvents } from './events';
import { appEventRegistry } from './registry';
import { FileEventType, trackFileEvent, trackFeedbackEvent, trackQueryExecutionEvent } from '@/lib/analytics/file-analytics.server';
import { enrichEventPayload, forwardToWebhooks } from '@/lib/messaging/app-events-notifier';
import { recordAppEvent } from '@/lib/analytics/app-events.db';
import { reportErrorToSentry } from './sentry-error-handler';

export { AppEvents } from './events';
export { appEventRegistry } from './registry';

// Register handlers — runs once when this module is first imported.
// To add a new handler (Slack, Sentry, etc.), add another subscribe() call here.
appEventRegistry.subscribe(AppEvents.FILE_CREATED,             p => trackFileEvent({ eventType: FileEventType.CREATED,           fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED,              p => trackFileEvent({ eventType: FileEventType.READ_DIRECT,       fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED_AS_REFERENCE, p => trackFileEvent({ eventType: FileEventType.READ_AS_REFERENCE, fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId, referencedByFileId: p.referencedByFileId }));
appEventRegistry.subscribe(AppEvents.FILE_UPDATED,             p => trackFileEvent({ eventType: FileEventType.UPDATED,           fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.FILE_DELETED,             p => trackFileEvent({ eventType: FileEventType.DELETED,           fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.QUERY_EXECUTED,           p => trackQueryExecutionEvent({ queryHash: p.queryHash, fileId: p.fileId, fileVersion: p.fileVersion, query: p.query, params: p.params, schemaContext: p.schemaContext, databaseName: p.databaseName, durationMs: p.durationMs, rowCount: p.rowCount, colCount: p.colCount, wasCacheHit: p.wasCacheHit, error: p.error, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.ERROR,                    p => reportErrorToSentry(p));
appEventRegistry.subscribe(AppEvents.FEEDBACK,                 p => trackFeedbackEvent({ conversationId: p.conversationId, userMessageLogIndex: p.userMessageLogIndex, rating: p.rating, tags: p.tags, comment: p.comment, userId: p.userId }));

// Cross-cutting sink for EVERY published event: enrich once with request/session
// context, then (a) store it in the local app_events log and (b) fan it out to any
// webhooks whose EVENTS_FORWARD_RULES regex matches (Slack channels, central ingest, …).
appEventRegistry.subscribeAll(async (event, payload) => {
  const enriched = await enrichEventPayload(event, payload as unknown as Record<string, unknown>);
  await Promise.allSettled([
    recordAppEvent(event, enriched),
    forwardToWebhooks(event, enriched),
  ]);
});
