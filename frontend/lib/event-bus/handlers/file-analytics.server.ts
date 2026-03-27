import 'server-only';
import { eventBus } from '../bus';
import { BusEvents } from '../events';
import { trackFileEvent, trackLLMCallEvents } from '@/lib/analytics/file-analytics.server';

export function registerFileAnalyticsHandlers(): void {
  eventBus.sub(BusEvents.FILE_CREATED, p =>
    trackFileEvent({ eventType: 'created', ...p }));

  eventBus.sub(BusEvents.FILE_VIEWED, p =>
    trackFileEvent({ eventType: 'read_direct', ...p }));

  eventBus.sub(BusEvents.FILE_VIEWED_AS_REFERENCE, p =>
    trackFileEvent({ eventType: 'read_as_reference', ...p }));

  eventBus.sub(BusEvents.FILE_UPDATED, p =>
    trackFileEvent({ eventType: 'updated', ...p }));

  eventBus.sub(BusEvents.FILE_DELETED, p =>
    trackFileEvent({ eventType: 'deleted', ...p }));

  eventBus.sub(BusEvents.LLM_CALL, p =>
    trackLLMCallEvents(p.llmCalls, p.conversationId, p.companyId, p.userId!, p.userEmail!, p.userRole!));
}
