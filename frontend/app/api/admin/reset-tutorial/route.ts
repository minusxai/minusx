/**
 * Admin-only API endpoint for resetting tutorial and internals modes to pristine template state
 * POST /api/admin/reset-tutorial
 *
 * Wipes ALL /tutorial and /internals documents (including user-created ones —
 * these modes are disposable demo/admin sandboxes) and re-inserts the canonical
 * seed docs for those two modes from workspace-template.json. It deliberately
 * NEVER touches /org, so real company state (e.g. /org/configs/config — branding,
 * setup-wizard status) is left untouched.
 * Useful for demos, onboarding resets, and testing.
 * Requires admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { getModules } from '@/lib/modules/registry';
import { DEFAULT_STYLES } from '@/lib/branding/whitelabel';
import { DEFAULT_DB_TYPE } from '@/lib/config';
import workspaceTemplate from '@/lib/database/workspace-template.json';
import { copySeedMxfoodForMode } from '@/lib/object-store';
import { MXFOOD_TABLES } from '@/lib/object-store/mxfood-tables';

export const POST = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    // Deep clone and apply template substitutions (same pattern as initializeDatabase())
    const templateContent = JSON.stringify(workspaceTemplate);
    const now = new Date().toISOString();
    const defaultDbType = DEFAULT_DB_TYPE;

    const processedTemplate = templateContent
      .replace(/\{\{ORG_NAME\}\}/g, '')
      .replace(/\{\{ADMIN_EMAIL\}\}/g, '')
      .replace(/\{\{ADMIN_NAME\}\}/g, '')
      .replace(/\{\{ADMIN_PASSWORD_HASH\}\}/g, '')
      .replace(/\{\{TIMESTAMP\}\}/g, now)
      .replace(/\{\{DEFAULT_DB_TYPE\}\}/g, defaultDbType)
      .replace(/"\{\{DEFAULT_STYLES\}\}"/g, JSON.stringify(DEFAULT_STYLES));

    const initData = JSON.parse(processedTemplate);

    // Support both flat (documents) and legacy nested format from template
    const allDocs: Array<{
      id: number;
      name: string;
      path: string;
      type: string;
      content: unknown;
      references?: unknown[];
      created_at: string;
      updated_at: string;
    }> = Array.isArray(initData.orgs ?? initData.companies)
      ? (initData.orgs ?? initData.companies as any[]).flatMap((c: any) => c.documents ?? [])
      : (initData.documents ?? []);

    // Scope STRICTLY to tutorial + internals — never /org. The seed template also
    // contains /org docs (incl. /org/configs/config, which holds the company's
    // setup-wizard + branding); resetting those would clobber real company state.
    const isTutorialOrInternals = (p: string) =>
      p === '/tutorial' || p.startsWith('/tutorial/') ||
      p === '/internals' || p.startsWith('/internals/');
    const seedDocs = allDocs.filter(d => isTutorialOrInternals(d.path));

    const db = getModules().db;

    // Wipe both modes wholesale (including any user-created files in them — these
    // modes are disposable demo/admin sandboxes), then re-seed.
    await db.exec(
      `DELETE FROM files
         WHERE path = '/tutorial' OR path LIKE '/tutorial/%'
            OR path = '/internals' OR path LIKE '/internals/%'`,
      []
    );

    // Re-insert the seed docs. ON CONFLICT DO NOTHING keeps this idempotent and
    // crash-free even if a template id/path drifted onto an existing row.
    for (const doc of seedDocs) {
      await db.exec(
        'INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING',
        [
          doc.id,
          doc.name,
          doc.path,
          doc.type,
          JSON.stringify(doc.content),
          JSON.stringify(doc.references || []),
          doc.created_at,
          doc.updated_at,
        ]
      );
    }

    // Re-copy mxfood seed Parquet files — best-effort
    copySeedMxfoodForMode('tutorial', MXFOOD_TABLES).then((copied) => {
      console.log(`[RESET_TUTORIAL] Re-copied ${copied.length}/${MXFOOD_TABLES.length} mxfood tables`);
    }).catch((err) =>
      console.warn('[RESET_TUTORIAL] mxfood S3 copy failed (non-fatal):', err)
    );

    return NextResponse.json({
      success: true,
      message: 'Workspace template reset to pristine state (user-created files preserved)',
      documentsCreated: seedDocs.length,
    });
  } catch (error: any) {
    console.error('Reset tutorial error:', error);
    return handleApiError(error);
  }
});
