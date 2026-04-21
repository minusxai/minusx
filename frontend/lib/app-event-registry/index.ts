import 'server-only';
import { AppEvents } from './events';
import { appEventRegistry } from './registry';
import { trackFileEvent, trackLLMCallEvents, trackQueryExecutionEvent } from '@/lib/analytics/file-analytics.server';
import { notifyErrorEvent } from '@/lib/messaging/error-notifier';
import { notifyAppEvent } from '@/lib/messaging/app-events-notifier';

export { AppEvents } from './events';
export type { AppEventName, AppEventPayloads } from './events';
export { appEventRegistry, AppEventRegistry } from './registry';

// Register handlers — runs once when this module is first imported.
// To add a new handler (Slack, Sentry, etc.), add another subscribe() call here.
appEventRegistry.subscribe(AppEvents.FILE_CREATED,             p => trackFileEvent({ eventType: 'created',           ...p }));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED,              p => trackFileEvent({ eventType: 'read_direct',       ...p }));
appEventRegistry.subscribe(AppEvents.FILE_VIEWED_AS_REFERENCE, p => trackFileEvent({ eventType: 'read_as_reference', ...p }));
appEventRegistry.subscribe(AppEvents.FILE_UPDATED,             p => trackFileEvent({ eventType: 'updated',           ...p }));
appEventRegistry.subscribe(AppEvents.FILE_DELETED,             p => trackFileEvent({ eventType: 'deleted',           ...p }));
appEventRegistry.subscribe(AppEvents.LLM_CALL,                 p => trackLLMCallEvents(p.llmCalls, p.conversationId, p.userId!, p.userEmail!, p.userRole!));
appEventRegistry.subscribe(AppEvents.QUERY_EXECUTED,           p => trackQueryExecutionEvent({ queryHash: p.queryHash, databaseName: p.databaseName, durationMs: p.durationMs, rowCount: p.rowCount, wasCacheHit: p.wasCacheHit, userEmail: p.userEmail ?? null }));
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
