/**
 * Error codes for data loading operations
 * Maps to common HTTP status codes and client-side errors
 */
export type ErrorCode =
  | 'NOT_FOUND'      // 404 - Resource doesn't exist
  | 'FORBIDDEN'      // 403 - No permission to access
  | 'UNAUTHORIZED'   // 401 - Not authenticated
  | 'SERVER_ERROR'   // 500+ - Server-side error
  | 'NETWORK_ERROR'  // Network/fetch failed
  | 'PARSE_ERROR'    // Invalid JSON or data format
  | 'UNKNOWN';       // Unexpected error

/**
 * Structured error information for data loading operations
 * Used consistently across files, folders, and conversations
 */
export interface LoadError {
  /** Human-readable error message */
  message: string;

  /** Error code for programmatic handling */
  code: ErrorCode;

  /** Optional HTTP status code */
  statusCode?: number;
}

/**
 * Create a LoadError from an HTTP response
 */
export function createLoadErrorFromResponse(status: number, message?: string): LoadError {
  let code: ErrorCode;

  switch (status) {
    case 401:
      code = 'UNAUTHORIZED';
      break;
    case 403:
      code = 'FORBIDDEN';
      break;
    case 404:
      code = 'NOT_FOUND';
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      code = 'SERVER_ERROR';
      break;
    default:
      code = 'UNKNOWN';
  }

  return {
    message: message || getDefaultErrorMessage(code),
    code,
    statusCode: status
  };
}

/**
 * Create a LoadError from a caught error
 */
export function createLoadErrorFromException(error: unknown): LoadError {
  if (error instanceof Error) {
    // Check if error has status code (from fetch errors)
    const errorWithStatus = error as any;
    if (errorWithStatus.status) {
      return createLoadErrorFromResponse(errorWithStatus.status, error.message);
    }

    // Check if it's a network error
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return {
        message: 'Network error. Please check your connection.',
        code: 'NETWORK_ERROR'
      };
    }

    // Check if it's a parse error
    if (error.message.includes('JSON') || error.message.includes('parse')) {
      return {
        message: 'Failed to parse response data.',
        code: 'PARSE_ERROR'
      };
    }

    return {
      message: error.message,
      code: 'UNKNOWN'
    };
  }

  return {
    message: String(error) || 'An unknown error occurred',
    code: 'UNKNOWN'
  };
}

/**
 * Get default error message for an error code
 */
function getDefaultErrorMessage(code: ErrorCode): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'Resource not found';
    case 'FORBIDDEN':
      return 'You do not have permission to access this resource';
    case 'UNAUTHORIZED':
      return 'Authentication required';
    case 'SERVER_ERROR':
      return 'Server error. Please try again later.';
    case 'NETWORK_ERROR':
      return 'Network error. Please check your connection.';
    case 'PARSE_ERROR':
      return 'Failed to parse response data';
    case 'UNKNOWN':
      return 'An unexpected error occurred';
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: LoadError): boolean {
  return error.code === 'NETWORK_ERROR' || error.code === 'SERVER_ERROR';
}
