/**
 * Helper functions for creating standardized API responses
 * Use these instead of manually constructing NextResponse objects
 */

import { NextResponse } from 'next/server';
import { ApiResponse, ErrorCode, ErrorCodes } from './api-types';
import { UserFacingError, FileExistsError, AccessPermissionError, FileNotFoundError } from '@/lib/errors';

/**
 * Create a success response
 */
export function successResponse<T>(
  data: T,
  status: number = 200
): NextResponse<ApiResponse<T>> {
  return NextResponse.json({
    success: true,
    data
  }, { status });
}

/**
 * Create an error response
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number = 500,
  details?: unknown
): NextResponse<ApiResponse> {
  return NextResponse.json({
    success: false,
    error: {
      code,
      message,
      details
    }
  }, { status });
}

/**
 * Common error responses (shortcuts)
 */
export const ApiErrors = {
  /**
   * 401 Unauthorized - User is not authenticated
   */
  unauthorized: (message = 'Unauthorized') =>
    errorResponse(ErrorCodes.UNAUTHORIZED, message, 401),

  /**
   * 403 Forbidden - User is authenticated but doesn't have permission
   */
  forbidden: (message = 'Forbidden') =>
    errorResponse(ErrorCodes.FORBIDDEN, message, 403),

  /**
   * 404 Not Found - Resource not found
   */
  notFound: (resource: string) =>
    errorResponse(ErrorCodes.NOT_FOUND, `${resource} not found`, 404),

  /**
   * 400 Bad Request - Validation error
   */
  validationError: (message: string, details?: unknown) =>
    errorResponse(ErrorCodes.VALIDATION_ERROR, message, 400, details),

  /**
   * 400 Bad Request - Generic bad request
   */
  badRequest: (message: string) =>
    errorResponse(ErrorCodes.BAD_REQUEST, message, 400),

  /**
   * 409 Conflict - Resource already exists or conflict detected
   */
  conflict: (message: string) =>
    errorResponse(ErrorCodes.CONFLICT, message, 409),

  /**
   * 500 Internal Server Error
   */
  internalError: (message = 'Internal server error') =>
    errorResponse(ErrorCodes.INTERNAL_ERROR, message, 500),

  /**
   * 500 Database Error
   */
  databaseError: (message: string) =>
    errorResponse(ErrorCodes.DATABASE_ERROR, message, 500),

  /**
   * 400 External API Error (SQL errors, query execution failures)
   */
  externalApiError: (message: string) =>
    errorResponse(ErrorCodes.EXTERNAL_API_ERROR, message, 400),

  /**
   * 500 Connection Error
   */
  connectionError: (message: string) =>
    errorResponse(ErrorCodes.CONNECTION_ERROR, message, 500),
};

/**
 * Handle errors in API routes
 * Converts thrown errors into proper API responses
 * Properly serializes UserFacingError and its subclasses with type information
 */
export function handleApiError(error: unknown): NextResponse<ApiResponse> {
  console.error('API Error:', error);

  // Handle UserFacingError and its subclasses
  if (error instanceof UserFacingError) {
    const serialized = error.toJSON();

    // Map error types to appropriate HTTP status codes
    let status = 400; // Default to bad request for user-facing errors
    let code: ErrorCode = ErrorCodes.VALIDATION_ERROR;

    if (error instanceof FileNotFoundError) {
      status = 404;
      code = ErrorCodes.NOT_FOUND;
    } else if (error instanceof AccessPermissionError) {
      status = 403;
      code = ErrorCodes.FORBIDDEN;
    } else if (error instanceof FileExistsError) {
      status = 409;
      code = ErrorCodes.CONFLICT;
    }

    return NextResponse.json({
      success: false,
      error: {
        code,
        message: serialized.message,
        type: serialized.type, // Include type for client-side deserialization
      }
    }, { status });
  }

  if (error instanceof Error) {
    // Fallback: Check message content for legacy error handling
    if (error.message.includes('not found')) {
      return ApiErrors.notFound('Resource');
    }
    if (error.message.includes('already exists')) {
      return ApiErrors.conflict(error.message);
    }
    if (error.message.includes('validation')) {
      return ApiErrors.validationError(error.message);
    }

    // Generic internal error
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR,
      error.message,
      500
    );
  }

  // Unknown error type
  return ApiErrors.internalError('An unexpected error occurred');
}
