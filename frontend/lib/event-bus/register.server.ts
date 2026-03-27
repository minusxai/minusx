import 'server-only';
import { registerFileAnalyticsHandlers } from './handlers/file-analytics.server';

let _registered = false;

export function ensureEventHandlersRegistered(): void {
  if (_registered) return;
  _registered = true;
  registerFileAnalyticsHandlers();
  // future: registerErrorHandlers(), registerSlackHandlers(), etc.
}
