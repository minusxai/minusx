import 'server-only';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { NextRequest } from 'next/server';
import { getQueryHash } from '@/lib/utils/query-hash';
import { analyticsDbExists, getAnalyticsDb, runQuery } from '@/lib/analytics/file-analytics.db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMPTY_ESTIMATE = { estimated_duration_ms: null, sample_count: 0, p50: null, p90: null };

// Use last 7 days of non-cached executions to estimate future runtime
const ESTIMATE_SQL = `
SELECT
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY duration_ms) AS p90,
  COUNT(*)::INTEGER AS sample_count
FROM query_execution_events
WHERE query_hash = ?
  AND was_cache_hit = false
  AND timestamp >= current_timestamp - INTERVAL '7 days'
`;

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const { query, params, database } = await request.json();

    if (!query || !database) return successResponse(EMPTY_ESTIMATE);

    // Don't create the analytics DB just to answer a read-only estimate request
    if (!analyticsDbExists()) return successResponse(EMPTY_ESTIMATE);

    const queryHash = getQueryHash(query, params ?? {}, database);
    const db = await getAnalyticsDb();
    const rows = await runQuery<Record<string, unknown>>(db, ESTIMATE_SQL, [queryHash]);
    const row = rows[0] ?? {};

    const sampleCount = Number(row['sample_count'] ?? 0);
    if (sampleCount === 0) return successResponse(EMPTY_ESTIMATE);

    const p50 = row['p50'] != null ? Math.round(Number(row['p50'])) : null;
    const p90 = row['p90'] != null ? Math.round(Number(row['p90'])) : null;

    return successResponse({ estimated_duration_ms: p50, sample_count: sampleCount, p50, p90 });
  } catch (error) {
    return handleApiError(error);
  }
});
