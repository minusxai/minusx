/**
 * Admin-only API endpoint for exporting database data
 * GET /api/admin/export-db
 *
 * Exports all users and documents to JSON format with validation metadata
 * Requires admin role
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { exportDatabase } from '@/lib/database/import-export';
import { validateInitData } from '@/lib/database/validation';
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

export const GET = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    const exportData = await exportDatabase();

    const validation = validateInitData(exportData);

    const jsonString = JSON.stringify(exportData, null, 2);
    const compressed = await gzipAsync(Buffer.from(jsonString, 'utf-8'));

    const filename = `atlas_export_${new Date().toISOString().split('T')[0]}.json.gz`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    };

    headers['X-Export-Stats'] = JSON.stringify({
      users: (exportData.users ?? []).length,
      documents: (exportData.documents ?? []).length,
    });

    if (!validation.valid) {
      headers['X-Validation-Status'] = 'invalid';
      headers['X-Validation-Errors'] = JSON.stringify(validation.errors);
      console.warn('⚠️  Exporting invalid database:', validation.errors);
    } else {
      headers['X-Validation-Status'] = 'valid';
    }

    if (validation.warnings.length > 0) {
      headers['X-Validation-Warnings'] = JSON.stringify(validation.warnings);
    }

    return new NextResponse(compressed, { status: 200, headers });
  } catch (error: any) {
    console.error('Export error:', error);
    return handleApiError(error);
  }
});
