import { QueryResult } from '@/lib/database/adapter/types';
import type { NextRequest, NextResponse } from 'next/server';
import type { AuthConfigOptions } from '@/lib/auth/auth-config-options';

export interface RequestContext {
  userId: number;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  home_folder: string;
  mode: 'org' | 'tutorial' | 'internals';
  impersonating?: string;
}

export interface PresignedUrl {
  url: string;
  fields: Record<string, string>;
}

/**
 * File System DB Module — owns all document DB reads/writes.
 * Default: PGLite in-process. Hosted: Postgres (external).
 */
export interface IFileSystemDBModule {
  exec<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  init(): Promise<void>;
  /** Run data migrations if behind LATEST_DATA_VERSION. Idempotent — safe to call on every startup. */
  runMigrations?(): Promise<void>;
  /** Release any held resources (connections, WASM handles). Optional — not all backends need it. */
  close?(): Promise<void>;
}

export interface RegisterInput {
  workspaceName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  inviteCode?: string;
}

export interface RegisterResult {
  redirectUrl: string;
}

/**
 * Auth Module — validates requests and builds RequestContext.
 * Default: NextAuth session. Hosted: NextAuth session.
 */
export interface IAuthModule {
  handleRequest(req: NextRequest): Promise<{
    context: RequestContext;
    response?: NextResponse;
  }>;
  getRequestContext(): Promise<RequestContext>;
  /** Returns true if request context was established (or no auth module active), false if request should be dropped. */
  addHeaders(req: NextRequest, headers: Headers, hints?: Record<string, string>): Promise<boolean>;
  register(input: RegisterInput): Promise<RegisterResult>;
  /** Auth-factory hooks consulted at login/refresh time. OSS: not implemented. */
  getAuthHooks?(): Partial<AuthConfigOptions>;
  /** Wrapper for after() callbacks */
  getContextRunner?(): (fn: () => Promise<unknown>) => Promise<unknown>;
  /** Extra fields to embed in OAuth access token JWT. OSS: returns {}. */
  getExtraTokenPayload?(userId: number, scope: string | null): Promise<Record<string, unknown>>;
}

/**
 * Object Store Module — owns all binary/blob storage.
 * Default: local filesystem or S3-compatible.
 * Hosted: S3 with per-deployment key prefix.
 */
export interface IObjectStoreModule {
  resolvePath(logicalKey: string, context: RequestContext): string;
  getUploadUrl(logicalKey: string, context: RequestContext): Promise<PresignedUrl>;
  getDownloadUrl(logicalKey: string, context: RequestContext): Promise<string>;
  generateKey(type: 'chart' | 'csv' | 'upload', context: RequestContext, ext: string): string;
}

/**
 * Cache Module — owns all caching.
 * Default: in-memory Map with optional TTL.
 * Hosted: Redis with per-deployment key prefix.
 */
export interface ICacheModule {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  invalidatePrefix(prefix: string): Promise<void>;
}
