/**
 * Validate and parse file ID from string
 * Throws error if ID is invalid
 */
export function validateFileId(id: string): number {
  const parsedId = parseInt(id, 10);

  if (isNaN(parsedId)) {
    throw new Error('Invalid file ID');
  }

  return parsedId;
}

/**
 * Validate array of file IDs
 * Throws error if any ID is invalid
 */
export function validateFileIds(ids: unknown): number[] {
  if (!ids || !Array.isArray(ids)) {
    throw new Error('ids array is required');
  }

  if (ids.some(id => typeof id !== 'number' || isNaN(id))) {
    throw new Error('All IDs must be valid numbers');
  }

  return ids as number[];
}
