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
import { seedLlmConfigFromEnv } from '@/lib/llm/llm-env-seed.server';
import { MXFOOD_TABLES } from '@/lib/object-store/mxfood-tables';
import { getRawConfig, saveRawConfig } from '@/lib/data/configs.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';

function escapeForJson(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

/**
 * Open source Auth Module — delegates to existing NextAuth session validation.
 * addHeaders() is a no-op.
 *
 * NOTE: Middleware integration (delegating handleRequest to this module) is
 * deferred to Phase 5. The existing middleware.ts remains authoritative.
 */
export class AuthModule implements IAuthModule {
  async handleRequest(_req: NextRequest): Promise<{ context: RequestContext; response?: NextResponse }> {
    throw new Error('handleRequest() — not yet wired into middleware');
  }

  async getUserKey(user: { mode: string }): Promise<string> {
    return user.mode;
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

  async addHeaders(_req: NextRequest, _headers: Headers): Promise<boolean> {
    return true;
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

    // setup.sh bootstrap: an interview-provided LLM config wins over any env
    // seed — save it FIRST (extract-on-write moves keys into the secrets
    // store), so seedLlmConfigFromEnv below sees `llm` present and no-ops.
    if (input.llm) {
      const raw = await getRawConfig(DEFAULT_MODE);
      await saveRawConfig(DEFAULT_MODE, { ...raw, llm: input.llm });
    }

    // Env → in-app LLM config: convert legacy model-config env vars (if any)
    // into the fresh workspace's config so a pre-provisioned install starts
    // configured (keys land in the secrets store; editable in Settings).
    try {
      await seedLlmConfigFromEnv();
    } catch (err) {
      console.warn('[AuthModule.register] LLM env seed failed (non-fatal):', err);
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
