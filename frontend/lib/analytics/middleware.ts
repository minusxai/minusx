import { Middleware } from '@reduxjs/toolkit';
import { analytics } from './analytics';

/**
 * Type guard to check if value is a Redux action
 */
function isAction(action: unknown): action is { type: string; payload?: unknown } {
  return typeof action === 'object' && action !== null && 'type' in action;
}

/**
 * Action patterns to blacklist (high volume, low signal)
 * Supports exact matches and wildcard patterns (*)
 *
 * Examples:
 * - 'queryResults/*'      - Block all queryResults actions
 * - '* /pending'           - Block all pending async thunks
 * - 'ui/toggleSidebar'    - Block specific action
 *
 * Start with empty array and add patterns as needed based on usage data
 */
const BLACKLISTED_ACTIONS: string[] = [
  // Add patterns here as needed
  // Example: 'queryResults/*',
];

/**
 * Check if action type matches any blacklist pattern
 */
function isBlacklisted(actionType: string): boolean {
  return BLACKLISTED_ACTIONS.some(pattern => {
    if (pattern.includes('*')) {
      // Wildcard matching
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(actionType);
    }
    // Exact match
    return actionType === pattern;
  });
}

/**
 * Redux middleware to automatically track all actions
 * Events are namespaced as "Redux/{sliceName}/{actionName}"
 * Example: "Redux/files/setFolderInfo"
 *
 * Blacklists high-volume, low-signal actions to reduce noise
 */
export const analyticsMiddleware: Middleware = (store) => (next) => (action) => {
  // Let the action pass through first
  const result = next(action);

  // Track the action (async, non-blocking)
  if (isAction(action)) {
    // Skip blacklisted actions
    if (isBlacklisted(action.type)) {
      return result;
    }

    // Use action type as event name with Redux/ prefix
    // e.g., "files/setFolderInfo" becomes "Redux/files/setFolderInfo"
    const eventName = `Redux/${action.type}`;

    analytics.captureEvent(eventName, {
      // Add minimal payload info (avoid sending large data)
      has_payload: !!action.payload,
    });
  }

  return result;
};
