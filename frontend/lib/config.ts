import 'server-only';

/**
 * Server-only environment configuration.
 * Secrets and server-side vars live here — DO NOT import from client components.
 * For client-safe vars (NEXT_PUBLIC_* and NODE_ENV), use lib/constants.ts instead.
 */

// Determine environment directly to avoid circular imports
const IS_DEV = process.env.NODE_ENV !== 'production';
const IS_TEST = process.env.NODE_ENV === 'test';
const IS_BROWSER = typeof window !== 'undefined';

interface EnvironmentConfig {
  AUTH_URL: string;
  BASE_DUCKDB_DATA_PATH: string;
  NEXTAUTH_SECRET: string;
  ADMIN_PWD: string | undefined;
  ALLOW_MULTIPLE_COMPANIES: boolean;
  CREATE_COMPANY_SECRET: string | undefined;
  DB_TYPE: 'sqlite' | 'postgres';
  DATABASE_URL: string;
  POSTGRES_URL: string | undefined;
  POSTGRES_SCHEMA: string;
  CRON_SECRET: string | undefined;
  MX_API_BASE_URL: string;
  MX_API_KEY: string;
  ANALYTICS_DB_DIR: string | undefined;
  DEFAULT_DB_TYPE: string;
  BACKEND_URL: string;
  INTERNAL_SLACK_CHANNEL_WEBHOOK: string | undefined;
  APP_EVENTS_SLACK_WEBHOOK: string | undefined;
  DEFAULT_EMAIL_WEBHOOK: string | undefined;
  SLACK_SIGNING_SECRET: string | undefined;
  SLACK_CLIENT_ID: string | undefined;
  SLACK_CLIENT_SECRET: string | undefined;
}

const errors: string[] = [];

function requireSecret(name: string, value: string | undefined): string {
  // In test mode, provide dummy values to allow tests to run
  if (IS_TEST) {
    return value || 'test-secret';
  }

  // In browser (client-side), server-only secrets won't be available - that's expected
  if (IS_BROWSER) {
    return value || '';
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
  AUTH_URL: getOptional(process.env.AUTH_URL, 'http://localhost:3000'),
  BASE_DUCKDB_DATA_PATH: getOptional(process.env.BASE_DUCKDB_DATA_PATH, IS_DEV ? '..' : '.'),

  NEXTAUTH_SECRET: requireSecret('NEXTAUTH_SECRET', process.env.NEXTAUTH_SECRET),

  ADMIN_PWD: process.env.ADMIN_PWD,

  ALLOW_MULTIPLE_COMPANIES: process.env.ALLOW_MULTIPLE_COMPANIES === 'true',
  CREATE_COMPANY_SECRET: process.env.CREATE_COMPANY_SECRET,
  DB_TYPE: getOptional(process.env.DB_TYPE, 'sqlite') as 'sqlite' | 'postgres',
  DATABASE_URL: getOptional(process.env.DATABASE_URL, 'data/atlas_documents.db'),
  POSTGRES_URL: process.env.POSTGRES_URL,
  POSTGRES_SCHEMA: getOptional(process.env.POSTGRES_SCHEMA, 'public'),
  CRON_SECRET: process.env.CRON_SECRET,
  MX_API_BASE_URL: getOptional(process.env.MX_API_BASE_URL, ''),
  MX_API_KEY: getOptional(process.env.MX_API_KEY, ''),
  ANALYTICS_DB_DIR: process.env.ANALYTICS_DB_DIR,
  DEFAULT_DB_TYPE: getOptional(process.env.DEFAULT_DB_TYPE, 'duckdb'),
  BACKEND_URL: getOptional(process.env.NEXT_PUBLIC_BACKEND_URL, 'http://localhost:8001'),
  INTERNAL_SLACK_CHANNEL_WEBHOOK: process.env.INTERNAL_SLACK_CHANNEL_WEBHOOK,
  APP_EVENTS_SLACK_WEBHOOK: process.env.APP_EVENTS_SLACK_WEBHOOK,
  DEFAULT_EMAIL_WEBHOOK: process.env.DEFAULT_EMAIL_WEBHOOK,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
};

// Skip validation in test mode or browser (client-side)
// Server-only secrets aren't available in browser - that's expected
if (errors.length > 0 && !IS_TEST && !IS_BROWSER) {
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

// Named exports
export const AUTH_URL = config.AUTH_URL;
export const BASE_DUCKDB_DATA_PATH = config.BASE_DUCKDB_DATA_PATH;
export const NEXTAUTH_SECRET = config.NEXTAUTH_SECRET;
export const ADMIN_PWD = config.ADMIN_PWD;
export const ALLOW_MULTIPLE_COMPANIES = config.ALLOW_MULTIPLE_COMPANIES;
export const CREATE_COMPANY_SECRET = config.CREATE_COMPANY_SECRET;
export const DB_TYPE = config.DB_TYPE;
export const DATABASE_URL = config.DATABASE_URL;
export const POSTGRES_URL = config.POSTGRES_URL;
export const POSTGRES_SCHEMA = config.POSTGRES_SCHEMA;
export const CRON_SECRET = config.CRON_SECRET;
export const MX_API_BASE_URL = config.MX_API_BASE_URL;
export const MX_API_KEY = config.MX_API_KEY;
export const ANALYTICS_DB_DIR = config.ANALYTICS_DB_DIR;
export const DEFAULT_DB_TYPE = config.DEFAULT_DB_TYPE;
export const BACKEND_URL = config.BACKEND_URL;
export const INTERNAL_SLACK_CHANNEL_WEBHOOK = config.INTERNAL_SLACK_CHANNEL_WEBHOOK;
export const APP_EVENTS_SLACK_WEBHOOK = config.APP_EVENTS_SLACK_WEBHOOK;
export const DEFAULT_EMAIL_WEBHOOK = config.DEFAULT_EMAIL_WEBHOOK;
export const SLACK_SIGNING_SECRET = config.SLACK_SIGNING_SECRET;
export const SLACK_CLIENT_ID = config.SLACK_CLIENT_ID;
export const SLACK_CLIENT_SECRET = config.SLACK_CLIENT_SECRET;
