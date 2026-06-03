/**
 * Error Parser Utility
 * Parses database error messages to extract key information
 */

export interface ParsedError {
  title: string;
  hint: string;
  details?: string;
  /** Transport-level failure (fetch rejected before an HTTP response). Retryable, not a SQL bug. */
  isNetworkError?: boolean;
}

// Browser-native messages emitted when fetch() fails at the transport layer
// (connection dropped, request aborted, gateway timeout, server restart).
// Chrome: "Failed to fetch" · Firefox: "NetworkError when attempting to fetch resource"
// Safari: "Load failed" · plus assorted Chromium net:: codes.
const NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'networkerror',
  'load failed',
  'network request failed',
  'err_network',
  'err_connection',
  'err_internet_disconnected',
];

/**
 * Parse error message to extract structured information
 */
export function parseErrorMessage(errorMsg: string): ParsedError {
  // Network / transport errors first — these are transient, so the right action
  // is "retry", not "fix the SQL". Suppress the raw details box for these.
  const lower = errorMsg.toLowerCase();
  if (NETWORK_ERROR_PATTERNS.some(p => lower.includes(p))) {
    return {
      title: "Couldn't load results",
      hint: 'There was a hiccup while loading. Hit retry to try again.',
      isNetworkError: true,
    };
  }

  // Extract SQLAlchemy error pattern
  const sqlAlchemyMatch = errorMsg.match(/\(sqlalchemy\.exc\.(\w+)\)\s*(.+?)(?:\[SQL:|$)/);
  if (sqlAlchemyMatch) {
    const [, errorType, message] = sqlAlchemyMatch;
    return {
      title: errorType.replace(/([A-Z])/g, ' $1').trim(),
      hint: message.trim(),
      details: errorMsg,
    };
  }

  // Extract bind parameter errors
  const bindParamMatch = errorMsg.match(/bind parameter ['"](\w+)['"]/);
  if (bindParamMatch) {
    return {
      title: 'Missing Parameter',
      hint: `Parameter ":${bindParamMatch[1]}" is required but no value was provided`,
      details: errorMsg,
    };
  }

  // Generic error
  return {
    title: 'Query Error',
    hint: errorMsg.split('[SQL:')[0].trim(),
    details: errorMsg,
  };
}
