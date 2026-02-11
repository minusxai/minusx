/**
 * Standard API response types
 * All API routes should return responses matching these interfaces
 */

/**
 * Standard API response format
 * All API routes must return this structure
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;      // Machine-readable error code (e.g., "NOT_FOUND")
    message: string;   // Human-readable error message
    details?: unknown; // Optional additional error context
  };
}

/**
 * Standard error codes
 * Use these constants instead of magic strings
 */
export const ErrorCodes = {
  // 400-level errors (client errors)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BAD_REQUEST: 'BAD_REQUEST',

  // 500-level errors (server errors)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * API Error class for throwing structured errors
 */
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
