/**
 * API route for IR → SQL conversion. Runs locally via the WASM-backed
 * `irToSqlLocal` helper.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/api-responses';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ir, dialect } = body;

    const sql = irToSqlLocal(ir, dialect);
    return NextResponse.json({ success: true, sql });
  } catch (error) {
    console.error('[API /ir-to-sql] Error:', error);
    return handleApiError(error);
  }
}
