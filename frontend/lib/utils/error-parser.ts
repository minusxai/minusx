/**
 * Error Parser Utility
 * Parses database error messages to extract key information
 */

export interface ParsedError {
  title: string;
  hint: string;
  details?: string;
}

/**
 * Parse error message to extract structured information
 */
export function parseErrorMessage(errorMsg: string): ParsedError {
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
