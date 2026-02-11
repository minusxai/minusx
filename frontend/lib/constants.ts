/**
 * Environment constants
 * Works both server-side and client-side in Next.js
 */
export const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * Application version
 * Update this when releasing new versions
 */
export const APP_VERSION = '0.1.0';

/**
 * Backend URLs
 * These use NEXT_PUBLIC_ prefix so they're available on both client and server
 */
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8001';
export const AUTH_URL = process.env.AUTH_URL || 'http://localhost:3000';

/**
 * Protected file paths that cannot be created or modified through the UI
 * These are legacy paths or system-reserved paths
 */
export const PROTECTED_FILE_PATHS = [
  '/config/users.yml',  // Legacy user management file (users now managed via database)
  // Add more protected paths as needed
] as const;
