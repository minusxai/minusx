import type { QuestionParameter, QuestionReference, QuestionContent } from '@/lib/types';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { NextRequest } from 'next/server';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { CTEfyQuery, ResolvedReference } from '@/lib/sql/query-composer';
import { FilesAPI } from '@/lib/data/files.server';

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
      // Array format: [{name: 'param1', value: 'val1', type: 'text'}, ...]
      (parameters as QuestionParameter[]).forEach(p => {
        if (p.defaultValue !== undefined && p.defaultValue !== null && p.defaultValue !== '') {
          paramValues[p.name] = p.defaultValue;
        }
      });
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

    console.log(`[QUERY API] Forwarding to Python backend: /api/execute-query`);
    // Forward request to Python backend (company ID header added automatically)
    // Python backend will idempotently initialize connection by fetching config from Next.js internal API
    const fetchStart = Date.now();
    const response = await pythonBackendFetch('/api/execute-query', {
      method: 'POST',
      body: JSON.stringify({
        query: finalQuery,
        parameters: paramValues,
        database_name,
      }),
    });
    console.log(`[QUERY API] Python backend fetch took ${Date.now() - fetchStart}ms`);

    const dataStart = Date.now();
    const data = await response.json();
    console.log(`[QUERY API] Response JSON parse took ${Date.now() - dataStart}ms`);

    if (!response.ok) {
      // If backend returned an error, wrap it in standard format
      return ApiErrors.externalApiError(data.detail || data.message || 'Query execution failed');
    }

    console.log(`[QUERY API] Total request time: ${Date.now() - startTime}ms`);
    return successResponse(data);
  } catch (error) {
    console.error(`[QUERY API] Error after ${Date.now() - startTime}ms:`, error);
    return handleApiError(error);
  }
});
