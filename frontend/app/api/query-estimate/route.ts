import 'server-only';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { NextRequest } from 'next/server';
import { getQueryHash } from '@/lib/utils/query-hash';
import { getModules } from '@/lib/modules/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMPTY_ESTIMATE = { estimated_duration_ms: null, sample_count: 0, p50: null, p90: null };

const ESTIMATE_SQL = `
SELECT
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY duration_ms) AS p90,
  COUNT(*)::INTEGER AS sample_count
FROM query_execution_events
WHERE query_hash = $1
  AND was_cache_hit = false
  AND created_at >= NOW() - INTERVAL '7 days'
`;

export const POST = withAuth(async (request: NextRequest) => {
  try {
    const { query, params, database } = await request.json();

    if (!query || !database) return successResponse(EMPTY_ESTIMATE);

    const queryHash = getQueryHash(query, params ?? {}, database);
    const result = await getModules().db.exec<Record<string, unknown>>(ESTIMATE_SQL, [queryHash]);
    const row = result.rows[0] ?? {};

    const sampleCount = Number(row['sample_count'] ?? 0);
    if (sampleCount === 0) return successResponse(EMPTY_ESTIMATE);

    const p50 = row['p50'] != null ? Math.round(Number(row['p50'])) : null;
    const p90 = row['p90'] != null ? Math.round(Number(row['p90'])) : null;

    return successResponse({ estimated_duration_ms: p50, sample_count: sampleCount, p50, p90 });
  } catch (error) {
    return handleApiError(error);
  }
});
