import type { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { IAuthModule, RequestContext, RegisterInput, RegisterResult } from '../types';
import { UserDB } from '@/lib/database/user-db';
import { atomicImport, InitData } from '@/lib/database/import-export';
import { applyMigrations } from '@/lib/database/migrations';
import { LATEST_DATA_VERSION } from '@/lib/database/constants';
import { hashPassword } from '@/lib/auth/password-utils';
import workspaceTemplate from '@/lib/database/workspace-template.json';
import { DEFAULT_STYLES } from '@/lib/branding/whitelabel';
import { copySeedMxfoodForMode } from '@/lib/object-store';
import { registerCompanyWithGateway } from '@/lib/gateway/gateway-register.server';
import { MXFOOD_TABLES } from '@/lib/object-store/mxfood-tables';
import { getRawConfig, saveRawConfig } from '@/lib/data/configs.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { getModules } from '@/lib/modules/registry';
import { buildNamespace } from '@/lib/namespace/types';

function escapeForJson(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

/**
 * Open source Auth Module — delegates to existing NextAuth session validation.
 * Namespace resolution is not here: middleware asks the namespace module directly, so
 * this module is only ever about who the user is.
 */
export class AuthModule implements IAuthModule {
  async handleRequest(_req: NextRequest): Promise<{ context: RequestContext; response?: NextResponse }> {
    return { context: await this.getRequestContext() };
  }

  /**
   * Re-establishes the current namespace for work that outlives the request — a
   * detached chat turn, an after() callback.
   *
   * Captured while the request is still alive (the namespace is read from the request
   * here), then re-entered around the work. Derived from the namespace module, so a
   * deployment that isolates workspaces needs no override.
   */
  async getContextRunner(): Promise<(fn: () => Promise<unknown>) => Promise<unknown>> {
    const ns = getModules().namespace;
    const namespace = await ns.isolation().catch(() => null);
    return namespace == null ? (fn) => fn() : (fn) => ns.with(namespace, fn);
  }

  /** The namespace this token belongs to, embedded so it survives into later requests. */
  async getExtraTokenPayload(): Promise<Record<string, unknown>> {
    return { namespace: await getModules().namespace.isolation().catch(() => undefined) };
  }

  async getUserKey(user: { mode: string }): Promise<string> {
    // The identity-scoped level of the namespace. A deployment that isolates
    // workspaces gets its coarser level folded in here without overriding anything.
    const { mode } = buildNamespace({
      isolation: await getModules().namespace.isolation(),
      mode: user.mode,
      userId: 0,
    });
    return mode;
  }

  async getRequestContext(): Promise<RequestContext> {
    const user = await getEffectiveUser();
    if (!user) throw new Error('Unauthenticated — no session found');
    return {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role as 'admin' | 'editor' | 'viewer',
      home_folder: user.home_folder,
      mode: user.mode as 'org' | 'tutorial' | 'internals',
      impersonating: undefined,
    };
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const users = await UserDB.listAll();
    if (users.length > 0) {
      throw new Error('Workspace already initialized — cannot register again');
    }

    const hash = await hashPassword(input.adminPassword);
    const now = new Date().toISOString();

    const templateStr = JSON.stringify(workspaceTemplate)
      .replace(/\{\{ORG_NAME\}\}/g, escapeForJson(input.workspaceName))
      .replace(/\{\{ADMIN_EMAIL\}\}/g, escapeForJson(input.adminEmail))
      .replace(/\{\{ADMIN_NAME\}\}/g, escapeForJson(input.adminName))
      .replace(/\{\{ADMIN_PASSWORD_HASH\}\}/g, escapeForJson(hash))
      .replace(/\{\{TIMESTAMP\}\}/g, escapeForJson(now))
      .replace(/"\{\{DEFAULT_STYLES\}\}"/g, JSON.stringify(DEFAULT_STYLES));

    const rawData: InitData = JSON.parse(templateStr);
    const initData = applyMigrations(rawData, rawData.version);
    initData.version = LATEST_DATA_VERSION;
    await atomicImport(initData);

    // Tutorial mode ships a CSV connection that points at parquet files which
    // must live on disk under LOCAL_UPLOAD_PATH/csvs/tutorial/mxfood/. Without
    // this best-effort copy, the very first tutorial query in a fresh install
    // explodes with a DuckDB "No files found that match the pattern" IO error.
    // Fire-and-forget so registration redirect isn't blocked on the (possibly
    // multi-MB) one-time download from the mxfood seed release.
    copySeedMxfoodForMode('tutorial', MXFOOD_TABLES).then((copied) => {
      console.log(`[AuthModule.register] Seeded ${copied.length}/${MXFOOD_TABLES.length} mxfood tutorial tables`);
    }).catch((err) => {
      console.warn('[AuthModule.register] mxfood tutorial seed failed (non-fatal):', err);
    });

    const warnings: string[] = [];

    // When MX_GATEWAY_SHARED_SECRET is set, register this
    // workspace with the MinusX gateway and wire it as the models provider, so
    // it is usable without configuring one by hand. Skipped when the installer
    // supplied a config below: an explicit choice should not be overwritten by
    // the default. Best-effort — registration has already committed, so an
    // outage leaves a working workspace rather than a half-registration that
    // cannot be repeated.
    if (!input.llm) {
      await registerCompanyWithGateway({
        email: input.adminEmail,
        workspaceName: input.workspaceName,
        appUrl: input.appUrl,
      });
    }

    // setup.sh bootstrap: the interview-provided LLM config, saved here so a
    // scripted install starts configured. Extract-on-write moves keys into the
    // secrets store.
    if (input.llm) {
      const raw = await getRawConfig(DEFAULT_MODE);
      await saveRawConfig(DEFAULT_MODE, { ...raw, llm: input.llm });
    }

    // setup.sh bootstrap: create the interview-provided first connection in
    // org mode. `create` re-tests the connection itself; failure surfaces as
    // a warning rather than failing the (already-committed) registration —
    // the user finishes it in the app's connection wizard.
    if (input.connection) {
      try {
        await ConnectionsAPI.create(input.connection, {
          userId: 0,
          email: input.adminEmail,
          name: input.adminName,
          role: 'admin',
          home_folder: '',
          mode: DEFAULT_MODE,
        });
      } catch (err) {
        warnings.push(`Connection '${input.connection.name}' was not created: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return warnings.length > 0 ? { redirectUrl: '/login', warnings } : { redirectUrl: '/login' };
  }
}
