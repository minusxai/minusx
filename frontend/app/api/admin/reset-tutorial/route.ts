/**
 * Admin-only API endpoint for resetting tutorial mode to pristine template state
 * POST /api/admin/reset-tutorial
 *
 * Wipes all tutorial-mode documents (paths under /tutorial/) and re-inserts
 * the 27 canonical tutorial docs from company-template.json.
 * Useful for demos, onboarding resets, and testing.
 * Requires admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors } from '@/lib/api/api-responses';
import { getAdapter, resetAdapter } from '@/lib/database/adapter/factory';
import { DEFAULT_STYLES } from '@/lib/branding/whitelabel';
import companyTemplate from '@/lib/database/company-template.json';

export const POST = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    const companyId = user.companyId;
    if (!companyId) {
      return ApiErrors.badRequest('Company ID not found in user session');
    }

    // Deep clone and apply template substitutions (same pattern as createNewCompany())
    const templateContent = JSON.stringify(companyTemplate);
    const now = new Date().toISOString();
    const defaultDbType = process.env.DEFAULT_DB_TYPE || 'duckdb';

    const processedTemplate = templateContent
      .replace(/"{{COMPANY_ID}}"/g, String(companyId))
      .replace(/\{\{COMPANY_NAME\}\}/g, '')
      .replace(/\{\{ADMIN_EMAIL\}\}/g, '')
      .replace(/\{\{ADMIN_NAME\}\}/g, '')
      .replace(/\{\{ADMIN_PASSWORD_HASH\}\}/g, '')
      .replace(/\{\{TIMESTAMP\}\}/g, now)
      .replace(/\{\{DEFAULT_DB_TYPE\}\}/g, defaultDbType)
      .replace(/"\{\{DEFAULT_STYLES\}\}"/g, JSON.stringify(DEFAULT_STYLES));

    const initData = JSON.parse(processedTemplate);

    // Filter to tutorial docs only
    const allDocs: Array<{
      id: number;
      name: string;
      path: string;
      type: string;
      content: unknown;
      references?: unknown[];
      company_id: number;
      created_at: string;
      updated_at: string;
    }> = initData.companies[0].documents;

    const tutorialDocs = allDocs.filter(
      (doc) => doc.path === '/tutorial' || doc.path.startsWith('/tutorial/')
    );

    // Execute in a transaction: delete all tutorial state, then re-insert template docs
    const db = await getAdapter();
    await db.transaction(async (tx) => {
      // Delete user-created tutorial files (any ID, tutorial path)
      await tx.query(
        "DELETE FROM files WHERE company_id = $1 AND (path = '/tutorial' OR path LIKE '/tutorial/%')",
        [companyId]
      );

      // Delete seed data orphans (low IDs that may not match tutorial paths after user edits)
      await tx.query(
        'DELETE FROM files WHERE company_id = $1 AND id < 100',
        [companyId]
      );

      // Re-insert all 27 tutorial template documents
      for (const doc of tutorialDocs) {
        await tx.query(
          'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [
            companyId,
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
    });

    // Flush WAL cache so subsequent requests see the new state
    await resetAdapter();

    return NextResponse.json({
      success: true,
      message: 'Tutorial reset to pristine template state',
      documentsCreated: tutorialDocs.length,
    });
  } catch (error: any) {
    console.error('Reset tutorial error:', error);
    return NextResponse.json(
      { success: false, errors: [error.message] },
      { status: 500 }
    );
  }
});
