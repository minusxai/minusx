/**
 * Mode type definitions for file system isolation
 * Modes enable separate file system contexts (org vs tutorial)
 */

// Mode type definition
export type Mode = 'org' | 'tutorial';

// Default mode
export const DEFAULT_MODE: Mode = 'org';

// Valid modes
export const VALID_MODES: Mode[] = ['org', 'tutorial'];

/**
 * Check if a string is a valid mode
 */
export function isValidMode(mode: string): mode is Mode {
  return VALID_MODES.includes(mode as Mode);
}
