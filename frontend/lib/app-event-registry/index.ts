import 'server-only';
import { AppEvents } from './events';
import { appEventRegistry } from './registry';
import { FileEventType, trackFileEvent, trackLLMCallEvents, trackQueryExecutionEvent } from '@/lib/analytics/file-analytics.server';
import { notifyErrorEvent } from '@/lib/messaging/error-notifier';
import { notifyAppEvent } from '@/lib/messaging/app-events-notifier';

export { AppEvents } from './events';
export type { AppEventName, AppEventPayloads } from './events';
export { appEventRegistry, AppEventRegistry } from './registry';

// Register handlers — runs once when this module is first imported.
// To add a new handler (Slack, Sentry, etc.), add another subscribe() call here.
appEventRegistry.subscribe(AppEvents.FILE_CREATED,             p => trackFileEvent({ eventType: FileEventType.CREATED,           fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED,              p => trackFileEvent({ eventType: FileEventType.READ_DIRECT,       fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED_AS_REFERENCE, p => trackFileEvent({ eventType: FileEventType.READ_AS_REFERENCE, fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId, referencedByFileId: p.referencedByFileId }));
appEventRegistry.subscribe(AppEvents.FILE_UPDATED,             p => trackFileEvent({ eventType: FileEventType.UPDATED,           fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.FILE_DELETED,             p => trackFileEvent({ eventType: FileEventType.DELETED,           fileId: p.fileId, fileVersion: p.fileVersion, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.LLM_CALL,                 p => trackLLMCallEvents(p.llmCalls, p.conversationId, p.userId ?? null));
appEventRegistry.subscribe(AppEvents.QUERY_EXECUTED,           p => trackQueryExecutionEvent({ queryHash: p.queryHash, fileId: p.fileId, fileVersion: p.fileVersion, query: p.query, params: p.params, schemaContext: p.schemaContext, databaseName: p.databaseName, durationMs: p.durationMs, rowCount: p.rowCount, colCount: p.colCount, wasCacheHit: p.wasCacheHit, error: p.error, userId: p.userId }));
appEventRegistry.subscribe(AppEvents.ERROR,                    p => notifyErrorEvent(p));
appEventRegistry.subscribe(AppEvents.FILE_CREATED,             p => notifyAppEvent(AppEvents.FILE_CREATED,             p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED,              p => notifyAppEvent(AppEvents.FILE_VIEWED,              p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED_AS_REFERENCE, p => notifyAppEvent(AppEvents.FILE_VIEWED_AS_REFERENCE, p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.FILE_UPDATED,             p => notifyAppEvent(AppEvents.FILE_UPDATED,             p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.FILE_DELETED,             p => notifyAppEvent(AppEvents.FILE_DELETED,             p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.FOLDER_CREATED,           p => notifyAppEvent(AppEvents.FOLDER_CREATED,           p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.LLM_CALL,                 p => notifyAppEvent(AppEvents.LLM_CALL,                 p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.QUERY_EXECUTED,           p => notifyAppEvent(AppEvents.QUERY_EXECUTED,           p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.JOB_CRON_SUCCEEDED,       p => notifyAppEvent(AppEvents.JOB_CRON_SUCCEEDED,       p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.JOB_CRON_FAILED,          p => notifyAppEvent(AppEvents.JOB_CRON_FAILED,          p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.MCP_TOOL_CALL,            p => notifyAppEvent(AppEvents.MCP_TOOL_CALL,            p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.USER_MESSAGE,             p => notifyAppEvent(AppEvents.USER_MESSAGE,             p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.USER_LOGGED_IN,           p => notifyAppEvent(AppEvents.USER_LOGGED_IN,           p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.USER_CREATED,             p => notifyAppEvent(AppEvents.USER_CREATED,             p as unknown as Record<string, unknown>));
appEventRegistry.subscribe(AppEvents.USER_DELETED,             p => notifyAppEvent(AppEvents.USER_DELETED,             p as unknown as Record<string, unknown>));
