/**
 * Admin-only API endpoint for resetting tutorial and internals modes to pristine template state
 * POST /api/admin/reset-tutorial
 *
 * Wipes all tutorial-mode and internals-mode documents and re-inserts
 * the canonical seed docs from workspace-template.json.
 * Useful for demos, onboarding resets, and testing.
 * Requires admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { getModules } from '@/lib/modules/registry';
import { DEFAULT_STYLES } from '@/lib/branding/whitelabel';
import { DEFAULT_DB_TYPE } from '@/lib/config';
import workspaceTemplate from '@/lib/database/workspace-template.json';
import { copySeedMxfoodForMode } from '@/lib/object-store';

const MXFOOD_TABLES = [
  'ad_campaigns', 'ad_spend', 'attribution', 'deliveries', 'drivers',
  'events', 'marketing_channels', 'order_items', 'orders', 'product_categories',
  'product_subcategories', 'products', 'promo_codes', 'promo_usage', 'restaurants',
  'subscription_plans', 'support_tickets', 'user_subscriptions', 'users', 'zones',
];

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

    const seedDocs = allDocs;
    // Delete by explicit template ID list — safe for existing DBs where user files
    // may have IDs < 1000 (created before the 1000-floor was introduced).
    const templateIds = seedDocs.map(d => d.id);

    const db = getModules().db;

    if (templateIds.length > 0) {
      await db.exec(
        `DELETE FROM files WHERE id = ANY($1::int[])`,
        [templateIds]
      );
    }

    // Re-insert all template documents
    for (const doc of seedDocs) {
      await db.exec(
        'INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
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
