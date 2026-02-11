/**
 * Custom Error Classes for User-Facing Errors
 *
 * UserFacingError: Base class for errors that should be displayed to users in the UI
 * Regular Error: Internal errors that should only be logged
 *
 * Error Hierarchy:
 * - UserFacingError (base)
 *   - FileExistsError (UNIQUE constraint violations)
 *   - AccessPermissionError (permission/access denied)
 *   - FileNotFoundError (file not found)
 */

/**
 * Error type for serialization across HTTP boundary
 */
export type SerializedError = {
  type: 'UserFacingError' | 'FileExistsError' | 'AccessPermissionError' | 'FileNotFoundError';
  message: string;
};

/**
 * Base class for errors that should be shown to the user in a toast/banner
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UserFacingError);
    }
  }

  /**
   * Serialize error for transmission over HTTP
   */
  toJSON(): SerializedError {
    return {
      type: this.name as SerializedError['type'],
      message: this.message
    };
  }
}

/**
 * Error thrown when a file with the same name already exists
 */
export class FileExistsError extends UserFacingError {
  constructor(fileName: string, location: string) {
    super(`A file named "${fileName}" already exists in ${location}. Please choose a different name.`);
    this.name = 'FileExistsError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FileExistsError);
    }
  }
}

/**
 * Error thrown when user lacks permission to perform an action
 */
export class AccessPermissionError extends UserFacingError {
  constructor(message: string = 'You do not have permission to perform this action') {
    super(message);
    this.name = 'AccessPermissionError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AccessPermissionError);
    }
  }
}

/**
 * Error thrown when a requested file is not found
 */
export class FileNotFoundError extends UserFacingError {
  constructor(fileId?: number | string) {
    super(fileId ? `File with ID ${fileId} not found` : 'File not found');
    this.name = 'FileNotFoundError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FileNotFoundError);
    }
  }
}

/**
 * Type guard to check if an error is a UserFacingError (or subclass)
 */
export function isUserFacingError(error: unknown): error is UserFacingError {
  return error instanceof UserFacingError;
}

/**
 * Deserialize error from API response
 * Reconstructs the appropriate error class based on type
 */
export function deserializeError(serialized: SerializedError): UserFacingError {
  switch (serialized.type) {
    case 'FileExistsError':
      // Extract fileName and location from message if possible, otherwise use generic
      const existsError = new UserFacingError(serialized.message);
      existsError.name = 'FileExistsError';
      return existsError;

    case 'AccessPermissionError':
      const permError = new UserFacingError(serialized.message);
      permError.name = 'AccessPermissionError';
      return permError;

    case 'FileNotFoundError':
      const notFoundError = new UserFacingError(serialized.message);
      notFoundError.name = 'FileNotFoundError';
      return notFoundError;

    default:
      return new UserFacingError(serialized.message);
  }
}
