import { QueryResult } from '@/lib/database/adapter/types';
import type { NextRequest, NextResponse } from 'next/server';
import type { AuthConfigOptions } from '@/lib/auth/auth-config-options';
import type { LlmConfig } from '@/lib/llm/llm-config-types';
import type { CreateConnectionInput } from '@/lib/data/connections.interface';

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
  /** Release any held resources (connections, WASM handles). Optional — not all backends need it. */
  close?(): Promise<void>;
  /** Close and nullify the adapter singleton so the next exec() gets a fresh instance. Test isolation only. */
  reset?(): Promise<void>;
  /** Emit a Postgres NOTIFY (chat v3 streaming wakeup). Payload is ~8KB-capped — carry pointers. */
  notify?(channel: string, payload: string): Promise<void>;
  /** Subscribe to NOTIFYs on a channel; returns an unsubscribe. Channel must be a safe identifier. */
  listen?(channel: string, onNotify: (payload: string) => void): Promise<() => Promise<void>>;
}

export interface RegisterInput {
  workspaceName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  inviteCode?: string;
  /**
   * Where this workspace will be reached, if that is not the deployment's own
   * `AUTH_URL`. A deployment serving several workspaces gives each its own host,
   * and support identifiers are useless if every one of them reports the same
   * address. Defaults to `AUTH_URL`.
   */
  appUrl?: string;
  /**
   * Optional bootstrap payload (setup.sh CLI interview): saved into the org
   * config at registration — with API keys secret-extracted — so the setup
   * wizard's Models stage is already complete on first login. Raw keys inline;
   * pre-init callers only (registration is first-run-gated).
   */
  llm?: LlmConfig;
  /** Optional first database connection, created in org mode after import.
   *  Failure does not fail registration — it surfaces in `warnings`. */
  connection?: CreateConnectionInput;
}

export interface RegisterResult {
  redirectUrl: string;
  /** Non-fatal bootstrap problems (e.g. the optional connection failed). */
  warnings?: string[];
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
  /**
   * Identity-scoped namespace for in-process caches (e.g. the query result cache).
   * Must include every dimension that distinguishes one user's data from another's
   * so that two users can never observe each other's cached results.
   */
  getUserKey(user: { mode: string }): Promise<string>;
  /** Auth-factory hooks consulted at login/refresh time. OSS: not implemented. */
  getAuthHooks?(): Partial<AuthConfigOptions>;
  /**
   * Returns a runner that re-establishes the current request's context for work
   * that outlives the request (after() callbacks, detached stream tasks). Captures
   * the context synchronously-from-the-request (async), so it must be awaited while
   * the request is still active, then used to wrap the background work.
   */
  getContextRunner?(): Promise<(fn: () => Promise<unknown>) => Promise<unknown>>;
  /** Extra fields to embed in an OAuth access token. */
  getExtraTokenPayload?(): Promise<Record<string, unknown>>;
}

/** Kinds of third-party identifier that can be bound to a namespace. */
export type ExternalIdKind = 'slack_team';

/**
 * Namespace Module — binds third-party identifiers to the namespace that owns them.
 *
 * Some inbound requests carry no session and no host that identifies the workspace:
 * a third-party webhook knows only its own workspace identifier. Resolving that to a
 * namespace has to happen *before* any request context exists, so it cannot read
 * namespace-scoped storage. Install time is the one moment both the external
 * identifier and the namespace are known — record the binding then.
 *
 * Default (single-namespace): both methods are no-ops, since there is nothing to
 * disambiguate.
 */
export interface INamespaceModule {
  /**
   * Request → the namespace it belongs to, or null to reject the request outright.
   *
   * Returns the namespace in its plain form — the same value `isolation()` yields — so
   * it can be passed straight to `with()`. Use `seal()` when it needs to travel as a
   * header.
   *
   * `hints` carries identifiers that only the caller can supply — a webhook's workspace
   * id, for instance — for requests whose namespace is not derivable from the URL.
   */
  resolve(req: NextRequest, hints?: Record<string, string>): Promise<string | null>;

  /**
   * Seal a namespace for transport as a request header.
   *
   * Middleware puts the result on the request and route handlers read it back, so it
   * crosses a boundary where a plain value would be attacker-controllable. A
   * single-namespace deployment has nothing to protect and returns it unchanged; one
   * serving several signs it. The sealed FORM is opaque to every caller.
   */
  seal(namespace: string): Promise<string>;

  /**
   * Establish a namespace where there is no request to read it from: cron, webhooks,
   * background work that outlives its request, tests.
   *
   * Scoped to `fn` — deliberately NOT an `enterWith`-style call that sets the ambient
   * context and everything after it, which cannot be unset and leaks into whatever runs
   * next on the same async context.
   */
  with<T>(namespace: string, fn: () => Promise<T>): Promise<T>;

  /**
   * The current request's isolation level — the coarse prefix every durable key is
   * scoped by. Constant in a single-workspace deployment.
   */
  isolation(): Promise<string>;
  /**
   * The OLDEST data version across every namespace this deployment serves.
   *
   * A build declares the range it can read (MINIMUM_SUPPORTED_DATA_VERSION) and the
   * version it writes (LATEST_DATA_VERSION). Raising the minimum is only safe once
   * every namespace has been migrated past it — otherwise the lagging one is served by
   * code that misreads its data. This is the number that makes that checkable before a
   * deploy rather than after.
   */
  minDataVersion(): Promise<number>;
  /**
   * Create a new namespace and seed it, returning where the caller should land.
   *
   * Provisioning, not authentication: a deployment that serves one workspace creates it
   * on first run, while one serving many creates a new namespace per signup. The
   * seeding itself is shared — only the namespace creation differs.
   */
  provision(input: RegisterInput): Promise<RegisterResult>;

  /**
   * Where an external integration's install should be finalised, or null to finish it
   * where it landed.
   *
   * Some providers require a fixed redirect URI, so the callback arrives at one host
   * while the user's session belongs to another. A deployment that serves several
   * namespaces on different hosts has to hand the install to the right one.
   */
  installFinishUrl(returnUrl: string): string | null;

  /** Record that `externalId` belongs to the calling namespace. Idempotent. */
  bindExternalId(kind: ExternalIdKind, externalId: string): Promise<void>;
  /** Forget a binding, e.g. on uninstall. Idempotent. */
  unbindExternalId(kind: ExternalIdKind, externalId: string): Promise<void>;
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
