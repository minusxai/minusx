/**
 * API route for SQL to IR conversion
 * Proxies to Python backend /api/sql-to-ir endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { handleApiError } from '@/lib/api/api-responses';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sql, databaseName } = body;

    // Pre-process: strip @ from @reference table names so sqlglot can parse them.
    // Collect the mapping so we can restore them in the IR response.
    const atRefs = new Map<string, string>(); // cleanName -> '@cleanName'
    const processedSql = (sql as string).replace(/@(\w+)/g, (_match: string, name: string) => {
      atRefs.set(name, `@${name}`);
      return name;
    });

    // Forward to Python backend
    const response = await pythonBackendFetch('/api/sql-to-ir', {
      method: 'POST',
      body: JSON.stringify({
        sql: processedSql,
        database_name: databaseName,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    // Post-process: restore @ prefixes in the returned IR
    if (data.ir) {
      const restoreRefs = (queryIR: any) => {
        if (queryIR.from?.table && atRefs.has(queryIR.from.table)) {
          queryIR.from.table = atRefs.get(queryIR.from.table);
        }
        for (const join of queryIR.joins ?? []) {
          if (join.table?.table && atRefs.has(join.table.table)) {
            join.table.table = atRefs.get(join.table.table);
          }
        }
      };

      if (data.ir.type === 'compound') {
        for (const query of data.ir.queries ?? []) {
          restoreRefs(query);
        }
      } else {
        restoreRefs(data.ir);
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[API /sql-to-ir] Error:', error);
    return handleApiError(error);
  }
}
