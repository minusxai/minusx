import type { QuestionReference, QuestionContent } from '@/lib/types';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { NextRequest } from 'next/server';
import { CTEfyQuery, ResolvedReference } from '@/lib/sql/query-composer';
import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';

// Route segment config: optimize for API routes
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  const startTime = Date.now();
  console.log('[QUERY API] Start POST /api/query');
  try {
    const parseStart = Date.now();
    const body = await request.json();
    console.log(`[QUERY API] JSON parse took ${Date.now() - parseStart}ms`);
    const { database_name, query, parameters, references } = body;

    // Convert parameters to Record<string, string | number> for backend
    // Handle both array format (QuestionParameter[]) and object format (Record<string, any>)
    const paramValues: Record<string, string | number> = {};
    if (Array.isArray(parameters)) {
      // Array format: legacy, no-op (parameters are now just schema definitions)
    } else if (typeof parameters === 'object' && parameters !== null) {
      // Object format: {param1: 'val1', param2: 'val2'}
      Object.assign(paramValues, parameters);
    }

    // Handle composed questions (CTE construction)
    let finalQuery = query;
    if (references && Array.isArray(references) && references.length > 0) {
      console.log(`[QUERY API] Constructing CTEs for ${references.length} references`);
      const cteStart = Date.now();

      // Load referenced questions from DB
      const resolvedRefs: ResolvedReference[] = await Promise.all(
        (references as QuestionReference[]).map(async (ref) => {
          const result = await FilesAPI.loadFile(ref.id, user);
          return {
            id: ref.id,
            alias: ref.alias,
            query: (result.data.content as QuestionContent).query
          };
        })
      );

      // Use extracted function to build CTEs
      finalQuery = CTEfyQuery(query, resolvedRefs);
      console.log(`[QUERY API] CTE construction took ${Date.now() - cteStart}ms`);
    }

    const result = await runQuery(database_name, finalQuery, paramValues, user);
    console.log(`[QUERY API] Total request time: ${Date.now() - startTime}ms`);
    return successResponse(result);
  } catch (error) {
    console.error(`[QUERY API] Error after ${Date.now() - startTime}ms:`, error);
    return handleApiError(error);
  }
});
