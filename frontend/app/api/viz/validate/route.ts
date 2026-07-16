import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { handleApiError } from '@/lib/http/api-responses';
import { validateVizEnvelope } from '@/lib/viz/validate';
import type { VizResultColumn } from '@/lib/viz/types';

/**
 * POST /api/viz/validate — validate a Viz V2 envelope (RFC §11).
 *
 * The validator lives server-side only (the vendored 1.4MB Vega-Lite schema must
 * never ship to the browser); this route is how browser-side callers reach it —
 * the EditFile/CreateFile tool handlers validate viz changes inline through here.
 *
 * Body: { viz: unknown, columns?: Array<{name, kind}> } — columns optional; field
 * checks are skipped when the query result is unknown.
 * Response: { success: true, data: { ok, issues } }
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const columns = Array.isArray(body.columns) ? (body.columns as VizResultColumn[]) : undefined;
    const result = validateVizEnvelope(body.viz, columns);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error);
  }
});
