/**
 * API route for SQL to IR conversion
 * Proxies to Python backend /api/sql-to-ir endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/api-responses';
import { parseSqlToIrLocal, UnsupportedSQLError } from '@/lib/sql/sql-to-ir';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sql, dialect } = body;

    // Pre-process: strip @ from @reference table names so the parser can handle them.
    const atRefs = new Map<string, string>();
    const processedSql = (sql as string).replace(/@(\w+)/g, (_match: string, name: string) => {
      atRefs.set(name, `@${name}`);
      return name;
    });

    // Parse locally via WASM
    const ir = await parseSqlToIrLocal(processedSql, dialect);

    // Post-process: restore @ prefixes in the returned IR
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

    if (ir.type === 'compound') {
      for (const query of (ir as any).queries ?? []) {
        restoreRefs(query);
      }
    } else {
      restoreRefs(ir);
    }

    return NextResponse.json({ success: true, ir });
  } catch (error) {
    if (error instanceof UnsupportedSQLError) {
      return NextResponse.json({
        success: false,
        error: error.message,
        unsupportedFeatures: error.features,
        hint: error.hint,
      }, { status: 422 });
    }
    console.error('[API /sql-to-ir] Error:', error);
    return handleApiError(error);
  }
}

