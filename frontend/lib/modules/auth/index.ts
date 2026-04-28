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

    return { redirectUrl: '/login' };
  }
}
