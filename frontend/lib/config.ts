/**
 * Centralized environment configuration with validation
 */

// Determine environment directly to avoid circular imports
const IS_DEV = process.env.NODE_ENV !== 'production';
const IS_TEST = process.env.NODE_ENV === 'test';

interface EnvironmentConfig {
  BACKEND_URL: string;
  AUTH_URL: string;
  BASE_DUCKDB_DATA_PATH: string;
  NEXTAUTH_SECRET: string;
  ADMIN_PWD: string | undefined;
}

const errors: string[] = [];

function requireSecret(name: string, value: string | undefined): string {
  // In test mode, provide dummy values to allow tests to run
  if (IS_TEST) {
    return value || 'test-secret';
  }

  if (!value || value.trim() === '') {
    errors.push(`${name} is required but not set. Add it to frontend/.env`);
    return '';
  }
  return value;
}

function getOptional(value: string | undefined, defaultValue: string): string {
  return value || defaultValue;
}

const config: EnvironmentConfig = {
  BACKEND_URL: getOptional(process.env.NEXT_PUBLIC_BACKEND_URL, 'http://localhost:8001'),
  AUTH_URL: getOptional(process.env.AUTH_URL, 'http://localhost:3000'),
  BASE_DUCKDB_DATA_PATH: getOptional(process.env.BASE_DUCKDB_DATA_PATH, IS_DEV ? '..' : '.'),

  NEXTAUTH_SECRET: requireSecret('NEXTAUTH_SECRET', process.env.NEXTAUTH_SECRET),

  ADMIN_PWD: process.env.ADMIN_PWD,
};

// Skip validation in test mode
if (errors.length > 0 && !IS_TEST) {
  const errorMessage = [
    '❌ Configuration Error: Missing required environment variables',
    '',
    ...errors,
    '',
    'To fix this:',
    '1. Copy frontend/.env.example to frontend/.env (if not already done)',
    '2. Generate secret:',
    '   - NEXTAUTH_SECRET: openssl rand -base64 32',
    '3. Add it to frontend/.env',
    '',
    'Example:',
    'NEXTAUTH_SECRET=<generated-secret-here>',
  ].join('\n');

  throw new Error(errorMessage);
}

export default config;

// Named exports for backwards compatibility
export const BACKEND_URL = config.BACKEND_URL;
export const AUTH_URL = config.AUTH_URL;
export const BASE_DUCKDB_DATA_PATH = config.BASE_DUCKDB_DATA_PATH;
export const NEXTAUTH_SECRET = config.NEXTAUTH_SECRET;
export const ADMIN_PWD = config.ADMIN_PWD;
