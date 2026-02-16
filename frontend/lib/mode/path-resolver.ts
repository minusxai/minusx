/**
 * Path resolution for mode-based file system isolation
 * Translates logical paths to physical paths with mode prefix
 */

import { Mode } from './mode-types';

/**
 * Resolve a logical path to a physical path with mode prefix
 *
 * @param mode - Current mode ('org', 'tutorial', etc.)
 * @param logicalPath - Path without mode prefix (e.g., '/database', '/logs/conversations')
 * @returns Physical path with mode prefix (e.g., '/org/database', '/tutorial/database')
 *
 * @example
 * resolvePath('org', '/database') → '/org/database'
 * resolvePath('tutorial', '/database') → '/tutorial/database'
 * resolvePath('org', '/logs/conversations/123') → '/org/logs/conversations/123'
 */
export function resolvePath(mode: Mode, logicalPath: string): string {
  // Handle empty path (mode root)
  if (!logicalPath || logicalPath === '/') {
    return `/${mode}`;
  }

  // Ensure logicalPath starts with /
  if (!logicalPath.startsWith('/')) {
    logicalPath = '/' + logicalPath;
  }

  // Don't double-prefix if already has mode
  if (logicalPath.startsWith(`/${mode}/`)) {
    return logicalPath;
  }

  return `/${mode}${logicalPath}`;
}

/**
 * Extract logical path from physical path by removing mode prefix
 *
 * @param physicalPath - Path with mode prefix (e.g., '/org/database')
 * @returns Logical path without mode prefix (e.g., '/database')
 */
export function extractLogicalPath(physicalPath: string): string {
  // Match pattern: /mode/rest_of_path
  const match = physicalPath.match(/^\/([^/]+)(\/.*)?$/);
  if (match && match[2]) {
    return match[2];
  }
  return physicalPath;
}

/**
 * Logical system folder paths (without mode prefix)
 * These are the canonical paths used across the application
 */
export const SYSTEM_FOLDERS = {
  database: '/database',
  configs: '/configs',
  logs: '/logs',
  logsConversations: '/logs/conversations',
  logsLlmCalls: '/logs/llm_calls',
  recordings: '/recordings',
  config: '/config',  // Legacy config folder
} as const;

/**
 * Check if a logical path is a system folder
 * @param logicalPath - Path without mode prefix (e.g., '/database', '/logs')
 * @returns true if the path is a system folder
 */
export function isSystemFolder(logicalPath: string, mode: Mode): boolean {
  const systemFolderPaths = Object.values(SYSTEM_FOLDERS);
  return systemFolderPaths.some(folder =>
    logicalPath === resolvePath(mode, folder)
  );
}

/**
 * System folders that should be hidden from the file browser
 * These folders have special dedicated views (e.g., /database has Connections page)
 */
export const HIDDEN_SYSTEM_FOLDERS = [
  SYSTEM_FOLDERS.database,
  SYSTEM_FOLDERS.configs,
  SYSTEM_FOLDERS.logs,
  SYSTEM_FOLDERS.config,
  SYSTEM_FOLDERS.recordings,
] as const;

/**
 * Get mode-specific system folders
 */
export function getSystemFolders(mode: Mode) {
  return {
    database: resolvePath(mode, SYSTEM_FOLDERS.database),
    configs: resolvePath(mode, SYSTEM_FOLDERS.configs),
    logs: resolvePath(mode, SYSTEM_FOLDERS.logs),
    logsConversations: resolvePath(mode, SYSTEM_FOLDERS.logsConversations),
    logsLlmCalls: resolvePath(mode, SYSTEM_FOLDERS.logsLlmCalls),
    recordings: resolvePath(mode, SYSTEM_FOLDERS.recordings),
  };
}

/**
 * Check if a physical path is a hidden system folder
 * @param physicalPath - Full path with mode prefix (e.g., '/org/database')
 * @param mode - Current mode
 * @returns true if the path should be hidden from file browser
 */
export function isHiddenSystemPath(physicalPath: string, mode: Mode): boolean {
  return HIDDEN_SYSTEM_FOLDERS.some(folder =>
    physicalPath === resolvePath(mode, folder)
  );
}

/**
 * Check if a path is under any system folder
 * @param physicalPath - Full path with mode prefix (e.g., '/org/database/my_connection')
 * @param mode - Current mode
 * @returns true if the path is under any system folder
 */
export function isUnderSystemFolder(physicalPath: string, mode: Mode): boolean {
  return HIDDEN_SYSTEM_FOLDERS.some(folder => {
    const systemPath = resolvePath(mode, folder);
    return physicalPath.startsWith(systemPath + '/') || physicalPath === systemPath;
  });
}

/**
 * File types that are allowed in system folders
 * - connection: must be in /database
 * - config: must be in /configs or /config
 * - conversation, session, llm_call: allowed in /logs
 * - connector: allowed in /recordings
 */
const SYSTEM_FOLDER_ALLOWED_TYPES = {
  '/database': ['connection'] as const,
  '/configs': ['config'] as const,
  '/config': ['config'] as const,
  '/logs': ['conversation', 'session', 'llm_call', 'report_run', 'alert_run'] as const,
  '/recordings': ['connector'] as const,
} as const;

/**
 * Check if a file type is allowed in a system folder path
 * @param fileType - The type of file being created
 * @param physicalPath - Full path with mode prefix
 * @param mode - Current mode
 * @returns true if the file type is allowed at this path
 */
export function isFileTypeAllowedInPath(fileType: string, physicalPath: string, mode: Mode): boolean {
  // Check each system folder
  for (const [folder, allowedTypes] of Object.entries(SYSTEM_FOLDER_ALLOWED_TYPES)) {
    const systemPath = resolvePath(mode, folder);

    // If path is under this system folder
    if (physicalPath.startsWith(systemPath + '/') || physicalPath === systemPath) {
      // Check if file type is allowed in this folder
      return (allowedTypes as readonly string[]).includes(fileType);
    }
  }

  // Not in a system folder - allowed
  return true;
}

/**
 * Get mode root folder
 */
export function getModeRoot(mode: Mode): string {
  return `/${mode}`;
}

/**
 * Resolve user home folder with graceful fallback
 *
 * If the exact home folder doesn't exist, tries parent folders until reaching mode root.
 * This provides graceful degradation when folders are deleted.
 *
 * @param mode - Current mode (org, tutorial, etc.)
 * @param logicalHomeFolder - Relative path without mode prefix (e.g., 'sales/team1')
 * @param checkExists - Optional function to check if path exists
 * @returns Physical path with mode prefix (e.g., '/org/sales/team1')
 *
 * @example
 * resolveHomeFolder('org', 'sales/team1')
 * // If /org/sales/team1 doesn't exist, tries /org/sales
 * // If /org/sales doesn't exist, returns /org
 */
export async function resolveHomeFolder(
  mode: Mode,
  logicalHomeFolder: string,
  checkExists?: (path: string) => Promise<boolean>
): Promise<string> {
  // Remove leading/trailing slashes from logical path
  const cleanPath = logicalHomeFolder.replace(/^\/+|\/+$/g, '');

  // If empty, return mode root
  if (!cleanPath) {
    return `/${mode}`;
  }

  // If no existence check provided, return resolved path directly
  if (!checkExists) {
    return resolvePath(mode, `/${cleanPath}`);
  }

  // Try full path first
  const fullPath = resolvePath(mode, `/${cleanPath}`);
  if (await checkExists(fullPath)) {
    return fullPath;
  }

  // Split path and try parents (e.g., 'sales/team1' -> ['sales', 'team1'])
  const segments = cleanPath.split('/').filter(Boolean);

  // Try progressively shorter paths: sales/team1 -> sales -> (mode root)
  for (let i = segments.length - 1; i > 0; i--) {
    const parentPath = resolvePath(mode, `/${segments.slice(0, i).join('/')}`);
    if (await checkExists(parentPath)) {
      return parentPath;
    }
  }

  // Final fallback: mode root (e.g., /org or /tutorial)
  return `/${mode}`;
}

/**
 * Synchronous version of resolveHomeFolder (no existence check)
 * Use this when you just need path construction without validation
 */
export function resolveHomeFolderSync(mode: Mode, logicalHomeFolder: string): string {
  const cleanPath = logicalHomeFolder.replace(/^\/+|\/+$/g, '');
  return cleanPath ? resolvePath(mode, `/${cleanPath}`) : `/${mode}`;
}
